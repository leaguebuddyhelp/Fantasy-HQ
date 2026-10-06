const NORMAL_CATEGORIES = Object.freeze({
    FINISHING: Object.freeze(["Layup", "Standing Dunk", "Dunk", "Close"]),
    SHOOTING: Object.freeze(["Mid Range", "3PT", "FT"]),
    "POST SCORING": Object.freeze(["Post Hook", "Post Fade", "Post Control"]),
    PLAYMAKING: Object.freeze(["Ball Handle", "Speed With Ball", "Pass", "Pass IQ", "Vision"]),
    "OFFENSIVE IQ": Object.freeze(["Draw Foul", "Shot IQ", "Hands", "Offensive Consistency"]),
    DEFENSE: Object.freeze(["Interior Defense", "Perimeter Defense", "Steal", "Block"]),
    "DEFENSIVE IQ": Object.freeze(["Help D IQ", "Pass Perception", "Defensive Consistency", "Hustle"]),
    REBOUNDING: Object.freeze(["Offensive Rebound", "Defensive Rebound"]),
});

const SPECIAL_UPGRADES = Object.freeze({
    "STRENGTH TRAINING": Object.freeze({ attributes: ["Strength +4"], weightLbs: 8 }),
    CONDITIONING: Object.freeze({ attributes: ["Speed +1", "Agility +1", "Vertical +1", "Stamina +3"], weightLbs: 0 }),
    "X-FACTOR": Object.freeze({ attributes: ["Potential +3"], weightLbs: 0 }),
});

const { randomUUID } = require("crypto");
const { PHASES } = require("./constants");
const { activeMemberships } = require("./service-helpers");
const { createFantasyHQRepository } = require("./repository");
const { playerTradeValue } = require("./asset-valuation");
const serviceLocks = new Map();

function validateNormalUpgrade(category, allocations) {
    const attributes = NORMAL_CATEGORIES[category];
    if (!attributes) throw new Error("Choose one of the eight normal upgrade categories.");
    if (!Array.isArray(allocations) || allocations.length === 0) throw new Error("Allocate at least one attribute point.");

    const seen = new Set();
    const normalized = allocations.map((allocation) => {
        const attribute = String(allocation?.attribute || "");
        const points = Number(allocation?.points);
        if (!attributes.includes(attribute)) throw new Error(`${attribute || "Attribute"} is not in ${category}.`);
        if (seen.has(attribute)) throw new Error(`${attribute} can only be allocated once.`);
        if (!Number.isInteger(points) || points < 1 || points > 3) throw new Error("Each attribute allocation must be between +1 and +3.");
        seen.add(attribute);
        return { attribute, points };
    });

    const total = normalized.reduce((sum, allocation) => sum + allocation.points, 0);
    if (total > 5) throw new Error("A normal upgrade can use at most five total points.");
    return { category, allocations: normalized, pointsUsed: total };
}

function emptyState() {
    return {
        version: 1,
        ownershipInitialized: false,
        currentOwners: {},
        knownCoaches: [],
        tenures: [],
        activeTenures: {},
        newUserEntitlements: [],
        teamSeasons: {},
        playerSeasons: {},
        requests: [],
        phases: {},
    };
}

function createPlayerUpgradeService(options = {}) {
    const repository = options.repository || createFantasyHQRepository(options);
    const submissions = options.submissions || require("./game-submissions").createGameSubmissionService({ repository });
    const now = options.now || (() => Date.now());
    let onUpgradeAvailable = options.onUpgradeAvailable || (() => { });

    function exclusive(leagueId, action) {
        const key = `${repository.dataRoot}:${leagueId}`;
        if (serviceLocks.has(key)) throw new Error("An upgrade action is already processing. Try again shortly.");
        serviceLocks.set(key, true);
        try { return action(); } finally { serviceLocks.delete(key); }
    }

    function loadState(leagueId) {
        const state = repository.loadPlayerUpgradeState(leagueId) || emptyState();
        Object.assign(state, {
            currentOwners: state.currentOwners || {},
            knownCoaches: state.knownCoaches || [],
            tenures: state.tenures || [],
            activeTenures: state.activeTenures || {},
            newUserEntitlements: state.newUserEntitlements || [],
            teamSeasons: state.teamSeasons || {},
            playerSeasons: state.playerSeasons || {},
            requests: state.requests || [],
            phases: state.phases || {},
        });
        return state;
    }

    function saveState(leagueId, state) {
        repository.savePlayerUpgradeState(leagueId, state);
    }

    function teamSeason(state, seasonId, teamId) {
        state.teamSeasons[seasonId] ||= {};
        state.teamSeasons[seasonId][teamId] ||= { specialUsed: false, activeRequestId: null };
        return state.teamSeasons[seasonId][teamId];
    }

    function playerSeason(state, seasonId, playerId) {
        state.playerSeasons[seasonId] ||= {};
        state.playerSeasons[seasonId][playerId] ||= { completed: [] };
        return state.playerSeasons[seasonId][playerId];
    }

    function tenureKey(seasonId, teamId) {
        return `${seasonId}:${teamId}`;
    }

    function currentTenure(state, seasonId, teamId, coachUserId) {
        const tenureId = state.activeTenures[tenureKey(seasonId, teamId)];
        const tenure = state.tenures.find(entry => entry.tenureId === tenureId);
        return tenure && tenure.coachUserId === String(coachUserId) && !tenure.endedAt ? tenure : null;
    }

    function openTenure(state, leagueId, seasonId, teamId, coachUserId, assignedAt = null) {
        const key = tenureKey(seasonId, teamId);
        const existing = state.tenures.find(entry => entry.tenureId === state.activeTenures[key]);
        if (existing && existing.coachUserId === String(coachUserId) && !existing.endedAt) return existing;
        if (existing && !existing.endedAt) existing.endedAt = new Date(now()).toISOString();
        const tenure = {
            tenureId: randomUUID(), leagueId, seasonId: String(seasonId), teamId,
            coachUserId: String(coachUserId), startedAt: assignedAt && Number.isFinite(Date.parse(assignedAt)) ? new Date(Date.parse(assignedAt)).toISOString() : new Date(now()).toISOString(),
            endedAt: null, qualifyingGames: [], spentGameUpgrades: 0, notifiedThresholds: [],
        };
        state.tenures.push(tenure);
        state.activeTenures[key] = tenure.tenureId;
        return tenure;
    }

    function expireRequest(state, request, reason) {
        if (!request || !["BUILDING", "PENDING_STAFF"].includes(request.status)) return false;
        request.status = "EXPIRED";
        request.expirationReason = reason;
        request.completedAt = new Date(now()).toISOString();
        const teamState = teamSeason(state, request.seasonId, request.teamId);
        if (teamState.activeRequestId === request.requestId) teamState.activeRequestId = null;
        return true;
    }

    function entitlementFor(state, coachUserId, teamId) {
        return state.newUserEntitlements.find(entry => entry.coachUserId === String(coachUserId) && entry.teamId === teamId
            && ["AVAILABLE", "LOCKED"].includes(entry.status));
    }

    function syncOwnerSnapshot({ leagueId, seasonId, owners, phase }) {
        return exclusive(leagueId, () => {
            const state = loadState(leagueId), ownerMap = Object.fromEntries((owners || []).map(owner => [owner.teamId, String(owner.userId)]));
            const teamIds = new Set([...Object.keys(state.currentOwners), ...Object.keys(ownerMap)]);
            const timestamp = new Date(now()).toISOString();
            const notifications = [];
            if (!state.ownershipInitialized) {
                state.currentOwners = ownerMap;
                state.ownershipInitialized = true;
                if (phase && !state.phases[seasonId]) state.phases[seasonId] = phase;
                for (const [teamId, coachUserId] of Object.entries(ownerMap)) {
                    state.knownCoaches.push(coachUserId);
                    const owner = (owners || []).find(entry => entry.teamId === teamId && String(entry.userId) === coachUserId);
                    openTenure(state, leagueId, seasonId, teamId, coachUserId, owner?.assignedAt || owner?.updatedAt);
                }
            } else {
                for (const teamId of teamIds) {
                    const previousCoach = state.currentOwners[teamId] || null;
                    const nextCoach = ownerMap[teamId] || null;
                    if (previousCoach === nextCoach) continue;
                    const oldTenure = currentTenure(state, seasonId, teamId, previousCoach);
                    if (oldTenure) oldTenure.endedAt = timestamp;
                    for (const request of state.requests.filter(entry => entry.teamId === teamId && String(entry.seasonId) === String(seasonId))) {
                        if (expireRequest(state, request, "COACH_CHANGED")) request.expiredAt = timestamp;
                    }
                    const oldEntitlement = previousCoach && entitlementFor(state, previousCoach, teamId);
                    if (oldEntitlement) oldEntitlement.status = "EXPIRED";
                    if (nextCoach) {
                        const owner = (owners || []).find(entry => entry.teamId === teamId && String(entry.userId) === nextCoach);
                        openTenure(state, leagueId, seasonId, teamId, nextCoach, owner?.assignedAt || owner?.updatedAt);
                        if (!state.knownCoaches.includes(nextCoach)) {
                            state.knownCoaches.push(nextCoach);
                            const regular = phase === PHASES.REGULAR_SEASON;
                            state.newUserEntitlements.push({
                                coachUserId: nextCoach, teamId, status: regular ? "AVAILABLE" : "LOCKED",
                                eligibleSeasonId: regular ? String(seasonId) : null,
                                issuedAt: timestamp, issuedDuringPhase: phase || null,
                            });
                            if (regular) notifications.push({ kind: "NEW_USER", leagueId, seasonId, teamId, coachUserId: nextCoach });
                        }
                    }
                }
                state.currentOwners = ownerMap;
            }
            saveState(leagueId, state);
            for (const notification of notifications) {
                try { Promise.resolve(onUpgradeAvailable(notification)).catch(error => console.error("Player upgrade DM failed:", error.message)); }
                catch (error) { console.error("Player upgrade DM failed:", error.message); }
            }
            return state;
        });
    }

    function handlePhase({ leagueId, seasonId, phase, owners }) {
        const state = loadState(leagueId);
        if (owners) syncOwnerSnapshot({ leagueId, seasonId, owners, phase });
        return exclusive(leagueId, () => {
            const current = loadState(leagueId), previous = current.phases[seasonId];
            const timestamp = new Date(now()).toISOString();
            const notifications = [];
            if (previous === PHASES.REGULAR_SEASON && phase !== PHASES.REGULAR_SEASON) {
                for (const request of current.requests.filter(entry => String(entry.seasonId) === String(seasonId))) expireRequest(current, request, "PLAYOFFS_STARTED");
                for (const entitlement of current.newUserEntitlements) {
                    if (String(entitlement.eligibleSeasonId) === String(seasonId) && entitlement.status === "AVAILABLE") entitlement.status = "EXPIRED";
                }
                for (const tenure of current.tenures.filter(entry => String(entry.seasonId) === String(seasonId) && !entry.endedAt)) tenure.spendingClosedAt = timestamp;
            }
            if (phase === PHASES.REGULAR_SEASON) {
                const ownersByTeam = current.currentOwners;
                if (current.lastRegularSeasonId !== String(seasonId)) {
                    for (const [priorSeasonId, priorPhase] of Object.entries(current.phases)) {
                        if (priorSeasonId === String(seasonId) || priorPhase !== PHASES.REGULAR_SEASON) continue;
                        for (const request of current.requests.filter(entry => entry.seasonId === priorSeasonId)) expireRequest(current, request, "SEASON_CHANGED");
                        for (const entitlement of current.newUserEntitlements) {
                            if (String(entitlement.eligibleSeasonId) === priorSeasonId && entitlement.status === "AVAILABLE") entitlement.status = "EXPIRED";
                        }
                        for (const tenure of current.tenures.filter(entry => entry.seasonId === priorSeasonId && !entry.endedAt)) {
                            tenure.endedAt = timestamp;
                            tenure.spendingClosedAt = timestamp;
                        }
                        current.phases[priorSeasonId] = PHASES.OFFSEASON;
                    }
                    for (const tenure of current.tenures.filter(entry => !entry.endedAt && String(entry.seasonId) !== String(seasonId))) tenure.endedAt = timestamp;
                    for (const [teamId, coachUserId] of Object.entries(ownersByTeam)) openTenure(current, leagueId, seasonId, teamId, coachUserId);
                    current.lastRegularSeasonId = String(seasonId);
                }
                for (const entitlement of current.newUserEntitlements) {
                    if (entitlement.status !== "LOCKED") continue;
                    if (ownersByTeam[entitlement.teamId] !== entitlement.coachUserId) { entitlement.status = "EXPIRED"; continue; }
                    entitlement.status = "AVAILABLE";
                    entitlement.eligibleSeasonId = String(seasonId);
                    notifications.push({ kind: "NEW_USER", leagueId, seasonId, teamId: entitlement.teamId, coachUserId: entitlement.coachUserId });
                }
            }
            current.phases[seasonId] = phase;
            saveState(leagueId, current);
            for (const notification of notifications) {
                try { Promise.resolve(onUpgradeAvailable(notification)).catch(error => console.error("Player upgrade DM failed:", error.message)); }
                catch (error) { console.error("Player upgrade DM failed:", error.message); }
            }
            return current;
        });
    }

    function gameTenure(state, seasonId, teamId, coachUserId, happenedAt) {
        const instant = Date.parse(happenedAt || "");
        return state.tenures.find(tenure => tenure.seasonId === String(seasonId) && tenure.teamId === teamId
            && tenure.coachUserId === String(coachUserId) && Date.parse(tenure.startedAt) <= instant
            && (!tenure.endedAt || Date.parse(tenure.endedAt) >= instant));
    }

    function reconcileFinalizedGames({ leagueId, seasonId, schedule }) {
        return exclusive(leagueId, () => {
            const activeLeague = repository.loadLeague(leagueId);
            if (activeLeague.seasonId !== String(seasonId) || activeLeague.league.currentPhase !== PHASES.REGULAR_SEASON) return { gamesCounted: 0, awards: [] };
            if (!schedule) schedule = repository.scheduleExists(leagueId, seasonId) ? repository.loadSchedule(leagueId, seasonId) : null;
            if (!schedule) return { gamesCounted: 0, awards: [] };
            const state = loadState(leagueId), { officialRegularGames } = require("./official-game");
            const awards = [], records = submissions.records();
            let gamesCounted = 0;
            const official = officialRegularGames(records, { leagueId, seasonId: String(seasonId), schedule });
            for (const record of official.games) {
                const resultSubmission = record.submissions.find(entry => entry.submissionId === record.game.result.submissionId);
                if (resultSubmission?.mode !== "TEAM_SIDES") continue;
                for (const teamId of [record.game.team1Id, record.game.team2Id]) {
                    const coachUserId = resultSubmission.participants?.[teamId];
                    const played = (record.playerGameStats || []).some(row => row.teamId === teamId && row.playerId && !row.dnp);
                    if (!coachUserId || !played) continue;
                    const tenure = gameTenure(state, seasonId, teamId, coachUserId, resultSubmission.createdAt);
                    if (!tenure || tenure.qualifyingGames.includes(record.game.gameId)) continue;
                    const previousThreshold = Math.floor(tenure.qualifyingGames.length / 4);
                    tenure.qualifyingGames.push(record.game.gameId);
                    gamesCounted += 1;
                    const nextThreshold = Math.floor(tenure.qualifyingGames.length / 4);
                    for (let threshold = previousThreshold + 1; threshold <= nextThreshold; threshold += 1) {
                        if (tenure.notifiedThresholds.includes(threshold)) continue;
                        tenure.notifiedThresholds.push(threshold);
                        awards.push({ kind: "GAME_EARNED", leagueId, seasonId: String(seasonId), teamId, coachUserId: String(coachUserId), qualifyingGames: tenure.qualifyingGames.length, available: nextThreshold - tenure.spentGameUpgrades });
                    }
                }
            }
            if (gamesCounted > 0) saveState(leagueId, state);
            for (const award of awards) {
                try { Promise.resolve(onUpgradeAvailable(award)).catch(error => console.error("Player upgrade DM failed:", error.message)); }
                catch (error) { console.error("Player upgrade DM failed:", error.message); }
            }
            return { gamesCounted, awards };
        });
    }

    function availableGameUpgrades(tenure) {
        if (!tenure || tenure.spendingClosedAt) return 0;
        return Math.max(0, Math.floor(tenure.qualifyingGames.length / 4) - tenure.spentGameUpgrades);
    }

    function getStatus({ leagueId, seasonId, teamId, coachUserId, phase, owners }) {
        if (owners) syncOwnerSnapshot({ leagueId, seasonId, owners, phase });
        handlePhase({ leagueId, seasonId, phase });
        this.reconcileFinalizedGames({ leagueId, seasonId });
        const state = loadState(leagueId), tenure = currentTenure(state, seasonId, teamId, coachUserId);
        const entitlement = state.newUserEntitlements.find(entry => entry.coachUserId === String(coachUserId) && entry.teamId === teamId && entry.status !== "EXPIRED");
        const team = teamSeason(state, seasonId, teamId);
        const qualifyingGames = tenure?.qualifyingGames.length || 0;
        return {
            teamId, coachUserId: String(coachUserId), seasonId: String(seasonId), phase,
            qualifyingGames, gamesToNextUpgrade: qualifyingGames % 4 === 0 && qualifyingGames > 0 ? 0 : 4 - (qualifyingGames % 4),
            gameEarnedAvailable: phase === PHASES.REGULAR_SEASON ? availableGameUpgrades(tenure) : 0,
            newUserStatus: !entitlement ? "NOT_ELIGIBLE" : entitlement.status === "AVAILABLE" && entitlement.eligibleSeasonId === String(seasonId) && phase === PHASES.REGULAR_SEASON ? "AVAILABLE" : entitlement.status === "USED" ? "USED" : "LOCKED_UNTIL_REGULAR_SEASON",
            special: team.specialUsed ? { status: "USED", type: team.specialType, playerId: team.specialPlayerId } : qualifyingGames >= 4 && phase === PHASES.REGULAR_SEASON ? { status: "AVAILABLE" } : { status: "LOCKED_UNTIL_FOUR_GAMES" },
            requestsAllowed: phase === PHASES.REGULAR_SEASON,
        };
    }

    function playerEligibility({ leagueId, seasonId, teamId }) {
        const state = loadState(leagueId), players = new Map(repository.loadPlayers(leagueId).map(player => [player.playerId, player]));
        return activeMemberships(repository.loadRosterMemberships(leagueId), seasonId).filter(membership => membership.teamId === teamId).map(membership => {
            const player = players.get(membership.playerId), record = playerSeason(state, seasonId, membership.playerId);
            const completed = record.completed || [];
            return { playerId: membership.playerId, name: player?.name || "Unknown player", completedUpgradeCount: completed.length, maxed: completed.length >= 2, usedCategories: completed.filter(entry => entry.type === "NORMAL").map(entry => entry.category), usedSpecials: completed.filter(entry => entry.type === "SPECIAL").map(entry => entry.specialType) };
        });
    }

    function invalidatePlayerRequests({ leagueId, seasonId, playerIds, reason }) {
        return exclusive(leagueId, () => {
            const state = loadState(leagueId), ids = new Set(playerIds || []);
            let changed = false;
            for (const request of state.requests) {
                if (request.seasonId !== String(seasonId) || !ids.has(request.playerId)) continue;
                changed = expireRequest(state, request, reason) || changed;
            }
            if (changed) saveState(leagueId, state);
            return changed;
        });
    }

    function reconcilePendingRequests({ leagueId }) {
        return exclusive(leagueId, () => {
            const state = loadState(leagueId), activeLeague = repository.loadLeague(leagueId), owners = new Map(repository.loadOwners(leagueId).map(owner => [owner.teamId, String(owner.userId)]));
            const memberships = activeMemberships(repository.loadRosterMemberships(leagueId), activeLeague.seasonId);
            const expired = [];
            for (const request of state.requests) {
                if (!['BUILDING', 'PENDING_STAFF'].includes(request.status)) continue;
                let reason = null;
                if (request.seasonId !== activeLeague.seasonId) reason = "SEASON_CHANGED";
                else if (activeLeague.league.currentPhase !== PHASES.REGULAR_SEASON) reason = "PLAYOFFS_STARTED";
                else if (owners.get(request.teamId) !== request.coachUserId || state.currentOwners[request.teamId] !== request.coachUserId) reason = "COACH_CHANGED";
                else if (!memberships.some(entry => entry.playerId === request.playerId && entry.teamId === request.teamId)) {
                    reason = memberships.some(entry => entry.playerId === request.playerId) ? "PLAYER_TRADED" : "PLAYER_NO_LONGER_ON_ROSTER";
                }
                if (reason && expireRequest(state, request, reason)) expired.push(request);
            }
            if (expired.length) saveState(leagueId, state);
            return expired;
        });
    }

    function history({ leagueId, seasonId, teamId, coachUserId }) {
        const state = loadState(leagueId);
        return state.requests.filter(request => request.seasonId === String(seasonId) && request.teamId === teamId && request.coachUserId === String(coachUserId));
    }

    function setRequestDiscordReference({ leagueId, requestId, channelId, messageId }) {
        return exclusive(leagueId, () => {
            const state = loadState(leagueId), request = state.requests.find(entry => entry.requestId === requestId);
            if (!request) throw new Error("Upgrade request not found.");
            request.discordChannelId = String(channelId);
            request.discordMessageId = String(messageId);
            saveState(leagueId, state);
            return request;
        });
    }

    function expireRequestById({ leagueId, requestId, reason }) {
        return exclusive(leagueId, () => {
            const state = loadState(leagueId), request = state.requests.find(entry => entry.requestId === requestId);
            if (!expireRequest(state, request, reason)) return request || null;
            saveState(leagueId, state);
            return request;
        });
    }

    function setNotificationHandler(handler) {
        onUpgradeAvailable = typeof handler === "function" ? handler : () => { };
    }

    function createRequest({ leagueId, seasonId, teamId, coachUserId, source, type, playerId, category, allocations, specialType, phase, owners }) {
        if (owners) syncOwnerSnapshot({ leagueId, seasonId, owners, phase });
        reconcilePendingRequests({ leagueId });
        return exclusive(leagueId, () => {
            const state = loadState(leagueId);
            const activeLeague = repository.loadLeague(leagueId);
            if (activeLeague.seasonId !== String(seasonId) || activeLeague.league.currentPhase !== PHASES.REGULAR_SEASON || phase !== PHASES.REGULAR_SEASON) throw new Error("Player upgrades can only be requested for the active season during the regular season.");
            if (state.currentOwners[teamId] !== String(coachUserId)) throw new Error("You no longer control this team's Coach role.");
            const team = teamSeason(state, seasonId, teamId);
            if (team.activeRequestId) throw new Error("Your team already has an active upgrade request.");
            const tenure = currentTenure(state, seasonId, teamId, coachUserId);
            const membership = activeMemberships(repository.loadRosterMemberships(leagueId), seasonId).find(entry => entry.playerId === playerId && entry.teamId === teamId);
            if (!membership) throw new Error("Choose a player on your current roster.");
            const player = repository.loadPlayers(leagueId).find(entry => entry.playerId === playerId);
            if (!player) throw new Error("The selected player no longer exists.");
            const playerRecord = playerSeason(state, seasonId, playerId);
            playerRecord.completed ||= [];
            if (playerRecord.completed.length >= 2) throw new Error("This player has reached the two-upgrade season limit.");
            if (source === "GAME_EARNED") {
                if (availableGameUpgrades(tenure) < 1) throw new Error("No game-earned upgrades are available.");
            } else if (source === "NEW_USER") {
                const entitlement = entitlementFor(state, coachUserId, teamId);
                if (!entitlement || entitlement.status !== "AVAILABLE" || entitlement.eligibleSeasonId !== String(seasonId)) throw new Error("No New User Upgrade is available.");
                if (type !== "NORMAL") throw new Error("A New User Upgrade can only be used for a normal category.");
            } else throw new Error("Choose an available upgrade source.");
            if (!tenure || tenure.spendingClosedAt) throw new Error("Your current coach tenure is not eligible for upgrades.");
            let upgrade;
            if (type === "NORMAL") {
                upgrade = validateNormalUpgrade(category, allocations);
                if (playerRecord.completed.some(entry => entry.type === "NORMAL" && entry.category === category)) throw new Error("This player already used that normal category this season.");
            } else if (type === "SPECIAL") {
                if (source !== "GAME_EARNED") throw new Error("Special upgrades require a game-earned upgrade.");
                if (tenure.qualifyingGames.length < 4) throw new Error("Special upgrades unlock after four qualifying games under your current tenure.");
                if (team.specialUsed) throw new Error("Your team already used its Special Upgrade this season.");
                if (!SPECIAL_UPGRADES[specialType]) throw new Error("Choose one of the three Special Upgrades.");
                upgrade = { specialType, changes: SPECIAL_UPGRADES[specialType] };
            } else throw new Error("Unknown upgrade type.");
            const request = {
                requestId: randomUUID(), leagueId, seasonId: String(seasonId), teamId, coachUserId: String(coachUserId),
                coachTenureId: tenure.tenureId, playerId, source, type, ...(type === "NORMAL" ? upgrade : { specialType, specialChanges: upgrade.changes }),
                playerSnapshot: { name: player.name || playerId, overall: player.overall ?? null, archetype: player.archetype ?? null, weightLbs: player.weightLbs ?? null },
                playerUpgradeCountBefore: playerRecord.completed.length,
                status: "PENDING_STAFF", submittedAt: new Date(now()).toISOString(),
            };
            state.requests.push(request);
            team.activeRequestId = request.requestId;
            saveState(leagueId, state);
            return request;
        });
    }

    function rejectRequest({ leagueId, requestId, staffUserId, staffAuthorized }) {
        return exclusive(leagueId, () => {
            if (!staffAuthorized) throw new Error("Only configured league Staff can reject upgrade requests.");
            const state = loadState(leagueId), request = state.requests.find(entry => entry.requestId === requestId);
            if (!request || request.status !== "PENDING_STAFF") throw new Error("This upgrade request is no longer pending.");
            request.status = "REJECTED"; request.staffUserId = String(staffUserId); request.completedAt = new Date(now()).toISOString();
            const team = teamSeason(state, request.seasonId, request.teamId);
            if (team.activeRequestId === requestId) team.activeRequestId = null;
            saveState(leagueId, state);
            repository.appendAuditLog(leagueId, { action: "player.upgrade.rejected", userId: String(staffUserId), timestamp: request.completedAt, metadata: { requestId, playerId: request.playerId, teamId: request.teamId } });
            return request;
        });
    }

    function completeRequest({ leagueId, requestId, staffUserId, staffAuthorized, phase, changeMode = "NO_CHANGE", newOverall, newBuild }) {
        return exclusive(leagueId, () => {
            if (!staffAuthorized) throw new Error("Only configured league Staff can approve upgrade requests.");
            const state = loadState(leagueId), request = state.requests.find(entry => entry.requestId === requestId);
            if (!request || request.status !== "PENDING_STAFF") throw new Error("This upgrade request is no longer pending.");
            const activeLeague = repository.loadLeague(leagueId);
            if (activeLeague.seasonId !== request.seasonId || activeLeague.league.currentPhase !== PHASES.REGULAR_SEASON || phase !== PHASES.REGULAR_SEASON) {
                expireRequest(state, request, activeLeague.seasonId !== request.seasonId ? "SEASON_CHANGED" : "PLAYOFFS_STARTED");
                saveState(leagueId, state);
                throw new Error("Player upgrades cannot be completed outside the active regular season.");
            }
            const currentOwner = repository.loadOwners(leagueId).find(owner => owner.teamId === request.teamId)?.userId;
            if (String(currentOwner || "") !== request.coachUserId || state.currentOwners[request.teamId] !== request.coachUserId) {
                expireRequest(state, request, "COACH_CHANGED"); saveState(leagueId, state); throw new Error("The requesting coach no longer controls this team.");
            }
            const membership = activeMemberships(repository.loadRosterMemberships(leagueId), request.seasonId).find(entry => entry.playerId === request.playerId && entry.teamId === request.teamId);
            if (!membership) {
                expireRequest(state, request, "PLAYER_NO_LONGER_ON_ROSTER"); saveState(leagueId, state); throw new Error("The player is no longer on the requesting team's roster.");
            }
            const players = repository.loadPlayers(leagueId), playerIndex = players.findIndex(entry => entry.playerId === request.playerId);
            if (playerIndex < 0) throw new Error("The selected player no longer exists.");
            const player = players[playerIndex], pSeason = playerSeason(state, request.seasonId, request.playerId), team = teamSeason(state, request.seasonId, request.teamId);
            pSeason.completed ||= [];
            if (pSeason.completed.length >= 2) throw new Error("The player reached the two-upgrade season limit before approval.");
            if (request.type === "NORMAL" && pSeason.completed.some(entry => entry.type === "NORMAL" && entry.category === request.category)) throw new Error("This player already used that normal category this season.");
            const tenure = currentTenure(state, request.seasonId, request.teamId, request.coachUserId);
            if (request.source === "GAME_EARNED" && availableGameUpgrades(tenure) < 1) throw new Error("The game-earned upgrade is no longer available.");
            const entitlement = entitlementFor(state, request.coachUserId, request.teamId);
            if (request.source === "NEW_USER" && (!entitlement || entitlement.status !== "AVAILABLE" || entitlement.eligibleSeasonId !== request.seasonId)) throw new Error("The New User Upgrade is no longer available.");
            if (request.type === "SPECIAL" && (team.specialUsed || request.source !== "GAME_EARNED" || !tenure || tenure.qualifyingGames.length < 4)) throw new Error("This Special Upgrade is no longer available.");
            const before = { overall: player.overall ?? null, archetype: player.archetype ?? null, weightLbs: player.weightLbs ?? null, tradeValue: playerTradeValue(player, request.seasonId) };
            const changeOVR = ["OVR_CHANGED", "BOTH_CHANGED"].includes(changeMode), changeBuild = ["BUILD_CHANGED", "BOTH_CHANGED"].includes(changeMode);
            if (!changeOVR && !["NO_CHANGE", "BUILD_CHANGED"].includes(changeMode)) throw new Error("Choose a valid approval update mode.");
            if (!changeBuild && !["NO_CHANGE", "OVR_CHANGED"].includes(changeMode)) throw new Error("Choose a valid approval update mode.");
            if (changeOVR) {
                const value = Number(newOverall);
                if (!Number.isInteger(value) || value < 0 || value > 99) throw new Error("OVR must be a whole number from 0 to 99.");
                player.overall = value;
            }
            if (changeBuild) {
                const validBuilds = new Set(players.map(entry => String(entry.archetype || "").trim()).filter(Boolean));
                if (!validBuilds.has(newBuild)) throw new Error("Choose a build already stored in LEAGUEbuddy.");
                player.archetype = newBuild;
            }
            if (request.type === "SPECIAL" && request.specialType === "STRENGTH TRAINING") {
                const weight = Number(player.weightLbs);
                if (!Number.isFinite(weight) || weight < 0) throw new Error("The player's stored weight is unavailable for Strength Training.");
                player.weightLbs = weight + 8;
            }
            player.updatedAt = new Date(now()).toISOString();
            const after = { overall: player.overall ?? null, archetype: player.archetype ?? null, weightLbs: player.weightLbs ?? null, tradeValue: playerTradeValue(player, request.seasonId) };
            const completedAt = player.updatedAt;
            const completed = {
                requestId, type: request.type, source: request.source,
                ...(request.type === "NORMAL" ? { category: request.category, allocations: request.allocations } : { specialType: request.specialType }),
                before, after, staffUserId: String(staffUserId), completedAt,
            };
            pSeason.completed.push(completed);
            if (request.source === "GAME_EARNED") tenure.spentGameUpgrades += 1;
            if (request.source === "NEW_USER") entitlement.status = "USED";
            if (request.type === "SPECIAL") { team.specialUsed = true; team.specialType = request.specialType; team.specialPlayerId = request.playerId; team.specialCompletedAt = completedAt; }
            request.status = "COMPLETED"; request.staffUserId = String(staffUserId); request.completedAt = completedAt; request.before = before; request.after = after;
            team.activeRequestId = null;
            const auditEntry = { action: "player.upgrade.completed", userId: String(staffUserId), leagueId, seasonId: request.seasonId, timestamp: completedAt, metadata: { requestId, playerId: request.playerId, teamId: request.teamId, source: request.source, type: request.type, category: request.category || null, specialType: request.specialType || null, before, after } };
            repository.commitPlayerUpgradeTransaction({ leagueId, players, upgradeState: state, auditEntry });
            return request;
        });
    }

    return {
        completeRequest,
        createRequest,
        expireRequestById,
        getStatus,
        handlePhase,
        history,
        invalidatePlayerRequests,
        reconcilePendingRequests,
        playerEligibility,
        reconcileFinalizedGames,
        rejectRequest,
        setRequestDiscordReference,
        setNotificationHandler,
        syncOwnerSnapshot,
        repository,
    };
}

module.exports = { NORMAL_CATEGORIES, SPECIAL_UPGRADES, createPlayerUpgradeService, validateNormalUpgrade };