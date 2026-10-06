const { randomUUID } = require("crypto");
const { activeMemberships } = require("./service-helpers");
const { createFantasyHQRepository } = require("./repository");
const { createStandingsService } = require("./standings-service");
const { PICK_PROTECTIONS, leagueAge, leagueSeasonStartYear, pickTradeValue, playerTradeValue, teamOutlooks } = require("./asset-valuation");

const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(["PENDING_GM_APPROVAL", "PENDING_COMMITTEE", "AWAITING_PROOF", "PENDING_PROOF_REVIEW"]);
const sharedLocks = new Map();

function createTradeService(options = {}) {
    const repository = options.repository || createFantasyHQRepository(options);
    const standingsService = options.standingsService || createStandingsService({ repository, ...(options.submissions ? { submissions: options.submissions } : {}) });
    const now = options.now || (() => Date.now());
    const onPlayersMoved = options.onPlayersMoved || null;

    function exclusive(leagueId, work) {
        const key = `${repository.dataRoot}:${leagueId}`;
        const previous = sharedLocks.get(key) || Promise.resolve();
        const pending = previous.catch(() => { }).then(work);
        sharedLocks.set(key, pending);
        return pending.finally(() => { if (sharedLocks.get(key) === pending) sharedLocks.delete(key); });
    }

    function timestamp() { return new Date(now()).toISOString(); }
    function audit(leagueId, trade, action, actorUserId, metadata = {}) {
        repository.appendAuditLog(leagueId, {
            action,
            userId: String(actorUserId || "system"),
            leagueId,
            seasonId: trade.seasonId,
            tradeId: trade.tradeId,
            version: trade.version,
            timestamp: timestamp(),
            metadata,
        });
    }
    function transition(leagueId, trade, status, actorUserId, reason = null) {
        const from = trade.status;
        trade.status = status;
        trade.updatedAt = timestamp();
        trade.history ||= [];
        trade.history.push({ from, to: status, actorUserId: String(actorUserId || "system"), reason, timestamp: trade.updatedAt, version: trade.version });
        repository.saveTrades(leagueId, repository.loadTrades(leagueId).map(entry => entry.tradeId === trade.tradeId ? trade : entry));
        audit(leagueId, trade, `trade.${status.toLowerCase()}`, actorUserId, { from, reason });
    }
    function saveNewTrade(leagueId, trade, actorUserId, action) {
        const trades = repository.loadTrades(leagueId);
        trades.push(trade);
        repository.saveTrades(leagueId, trades);
        audit(leagueId, trade, action, actorUserId, { participatingTeams: trade.participatingTeams });
    }
    function currentContext(leagueId, seasonId) {
        const context = repository.loadLeague(leagueId, seasonId);
        const players = repository.loadPlayers(leagueId);
        const playerById = new Map(players.map(player => [player.playerId, player]));
        const memberships = activeMemberships(repository.loadRosterMemberships(leagueId), context.seasonId);
        const membershipByPlayer = new Map();
        const membershipsByPlayer = new Map();
        const rosterByTeam = new Map(context.teams.map(team => [team.teamId, []]));
        for (const membership of memberships) {
            if (!membershipByPlayer.has(membership.playerId)) membershipByPlayer.set(membership.playerId, membership);
            if (!membershipsByPlayer.has(membership.playerId)) membershipsByPlayer.set(membership.playerId, []);
            membershipsByPlayer.get(membership.playerId).push(membership);
            const player = playerById.get(membership.playerId);
            if (player && rosterByTeam.has(membership.teamId)) rosterByTeam.get(membership.teamId).push({
                ...player,
                teamId: membership.teamId,
                position1: membership.position1 ?? player.position1,
                position2: membership.position2 ?? player.position2,
            });
        }
        const standings = standingsService.getStandings(leagueId, context.seasonId);
        const standingsByTeam = new Map(Object.values(standings.conferences).flat().map(team => [team.teamId, team]));
        const outlooks = teamOutlooks(context.teams, rosterByTeam, standingsByTeam, context.league.currentWeek, context.seasonId);
        const picks = repository.loadDraftPicks(leagueId);
        const pickById = new Map(picks.map(pick => [pick.pickId, pick]));
        return { context, players, playerById, memberships, membershipByPlayer, membershipsByPlayer, rosterByTeam, standingsByTeam, outlooks, picks, pickById, owners: repository.loadOwners(leagueId), settings: repository.loadSettings(leagueId) || {} };
    }

    function initializeDraftPicks({ leagueId, seasonId, actingUserId = "system" }) {
        const { context } = currentContext(leagueId, seasonId);
        const currentYear = leagueSeasonStartYear(context.seasonId);
        const picks = repository.loadDraftPicks(leagueId);
        const existing = new Set(picks.map(pick => pick.pickId));
        let created = 0;
        for (let year = currentYear + 1; year <= currentYear + 5; year += 1) {
            for (const team of context.teams) for (const round of [1, 2]) {
                const pickId = `pick_${year}_${round}_${team.teamId}`;
                if (existing.has(pickId)) continue;
                picks.push({
                    leagueId,
                    pickId,
                    draftYear: year,
                    round,
                    originalTeamId: team.teamId,
                    currentOwnerTeamId: team.teamId,
                    protection: "UNPROTECTED",
                    ownershipHistory: [{ teamId: team.teamId, action: "CREATED", timestamp: timestamp(), tradeId: null }],
                    createdAt: timestamp(),
                });
                created += 1;
            }
        }
        if (created) {
            repository.saveDraftPicks(leagueId, picks);
            repository.appendAuditLog(leagueId, { action: "draft-picks.initialized", userId: String(actingUserId), leagueId, seasonId: context.seasonId, timestamp: timestamp(), metadata: { created, through: currentYear + 5 } });
        }
        return { created, picks };
    }

    function tradeCounts(leagueId, seasonId) {
        const context = repository.loadLeague(leagueId, seasonId);
        const counts = new Map(context.teams.map(team => [team.teamId, 0]));
        for (const trade of repository.loadTrades(leagueId)) {
            if (trade.seasonId !== context.seasonId || trade.status !== "COMPLETED") continue;
            for (const teamId of trade.participatingTeams || []) counts.set(teamId, (counts.get(teamId) || 0) + 1);
        }
        return counts;
    }

    function getLiveSnapshot(leagueId, seasonId) {
        const state = currentContext(leagueId, seasonId);
        const counts = tradeCounts(leagueId, state.context.seasonId);
        const currentYear = leagueSeasonStartYear(state.context.seasonId);
        const teams = state.context.teams.map(team => ({
            ...team,
            rosterSize: state.rosterByTeam.get(team.teamId)?.length || 0,
            completedTrades: counts.get(team.teamId) || 0,
            tradeCountLimit: 5,
            outlook: state.outlooks.get(team.teamId),
        }));
        const players = [...state.rosterByTeam.values()].flat().map(player => ({
            ...player,
            age: leagueAge(player.birthdate, state.context.seasonId),
            tradeValue: playerTradeValue(player, state.context.seasonId),
        }));
        const picks = state.picks.filter(pick => pick.draftYear > currentYear && pick.draftYear <= currentYear + 5).map(pick => ({
            ...pick,
            tradeValue: pickTradeValue({ round: pick.round, draftYear: pick.draftYear, currentYear, originalTeamId: pick.originalTeamId, outlooks: state.outlooks, protection: pick.protection }).value,
        }));
        return { league: state.context.league, seasonId: state.context.seasonId, teams, players, picks };
    }

    function normalizeTransfers(transfers = []) {
        return transfers.map(transfer => ({
            assetType: String(transfer.assetType || "").toUpperCase(),
            assetId: String(transfer.assetId || ""),
            fromTeamId: String(transfer.fromTeamId || ""),
            toTeamId: String(transfer.toTeamId || ""),
            ...(transfer.protection ? { protection: String(transfer.protection).toUpperCase() } : {}),
        }));
    }

    function createDraft({ leagueId, seasonId, initiatingUserId, initiatingTeamId, secondTeamId = null }) {
        const state = currentContext(leagueId, seasonId);
        const teamIds = [initiatingTeamId, secondTeamId].filter(Boolean);
        if (!state.context.teams.some(team => team.teamId === initiatingTeamId)) throw new Error("Choose a valid initiating team.");
        if (teamIds.length !== new Set(teamIds).size || teamIds.length > 3) throw new Error("A trade must include two or three different teams.");
        const nowIso = timestamp();
        const trade = {
            tradeId: randomUUID(), leagueId, seasonId: state.context.seasonId, version: 1, parentTradeId: null, previousVersionId: null,
            status: "DRAFT", createdAt: nowIso, updatedAt: nowIso, initiatingUserId: String(initiatingUserId), initiatingTeamId,
            participatingTeams: teamIds, transfers: [], versions: [], history: [], originSubmittedAt: null,
        };
        saveNewTrade(leagueId, trade, initiatingUserId, "trade.draft.created");
        return trade;
    }

    function updateDraft({ leagueId, tradeId, actorUserId, participatingTeams, transfers }) {
        const trade = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId);
        if (!trade || trade.status !== "DRAFT") throw new Error("This trade draft is no longer editable.");
        if (trade.initiatingUserId !== String(actorUserId)) throw new Error("Only the coach building this proposal can edit it.");
        const teamIds = participatingTeams || trade.participatingTeams;
        if (teamIds.length < 2 || teamIds.length > 3 || new Set(teamIds).size !== teamIds.length) throw new Error("A trade must include two or three different teams.");
        trade.participatingTeams = [...teamIds];
        trade.transfers = normalizeTransfers(transfers ?? trade.transfers).filter(transfer => trade.participatingTeams.includes(transfer.fromTeamId) && trade.participatingTeams.includes(transfer.toTeamId));
        trade.updatedAt = timestamp();
        repository.saveTrades(leagueId, repository.loadTrades(leagueId).map(entry => entry.tradeId === tradeId ? trade : entry));
        return thisPreview(leagueId, trade);
    }

    function thisPreview(leagueId, trade, options = {}) {
        const state = currentContext(leagueId, trade.seasonId);
        const currentYear = leagueSeasonStartYear(state.context.seasonId);
        const currentCounts = tradeCounts(leagueId, trade.seasonId);
        const sent = new Map(trade.participatingTeams.map(teamId => [teamId, 0]));
        const received = new Map(trade.participatingTeams.map(teamId => [teamId, 0]));
        const playersOut = new Map(trade.participatingTeams.map(teamId => [teamId, 0]));
        const playersIn = new Map(trade.participatingTeams.map(teamId => [teamId, 0]));
        const errors = [];
        const currentWeek = Number(state.context.league.currentWeek);
        const withinNewTradeWindow = state.context.league.currentPhase === "REGULAR_SEASON" && Number.isInteger(currentWeek) && currentWeek >= 1 && currentWeek <= 9;
        if (!withinNewTradeWindow && !trade.originSubmittedAt) errors.push(state.context.league.currentPhase === "PLAYOFFS" ? "Trading is closed during the playoffs." : "New trades may be submitted only through Week 9.");
        const seenAssets = new Set();
        let assetCount = 0;
        const transfers = normalizeTransfers(trade.transfers);
        for (const transfer of transfers) {
            const { assetType, assetId, fromTeamId, toTeamId } = transfer;
            const identity = `${assetType}:${assetId}`;
            if (!assetId || seenAssets.has(identity)) { errors.push(`Duplicate or missing asset ${assetId || "(unknown)"}.`); continue; }
            seenAssets.add(identity);
            if (!trade.participatingTeams.includes(fromTeamId) || !trade.participatingTeams.includes(toTeamId) || fromTeamId === toTeamId) { errors.push("Every asset must move between two different participating teams."); continue; }
            let value;
            if (assetType === "PLAYER") {
                const player = state.playerById.get(assetId), membership = state.membershipByPlayer.get(assetId);
                if (!player || !membership) { errors.push(`Player ${assetId} no longer exists on an active roster.`); continue; }
                if ((state.membershipsByPlayer.get(assetId) || []).length !== 1) { errors.push(`${player.name} does not have exactly one active team owner.`); continue; }
                if (membership.teamId !== fromTeamId) { errors.push(`${player.name} is no longer on ${state.context.teams.find(team => team.teamId === fromTeamId)?.teamName || fromTeamId}.`); continue; }
                value = playerTradeValue({ ...player, position1: membership.position1 ?? player.position1, position2: membership.position2 ?? player.position2 }, state.context.seasonId);
                playersOut.set(fromTeamId, playersOut.get(fromTeamId) + 1);
                playersIn.set(toTeamId, playersIn.get(toTeamId) + 1);
            } else if (assetType === "PICK") {
                const pick = state.pickById.get(assetId);
                if (!pick) { errors.push(`Draft pick ${assetId} does not exist.`); continue; }
                if (pick.currentOwnerTeamId !== fromTeamId) { errors.push(`${pick.draftYear} ${state.context.teams.find(team => team.teamId === pick.originalTeamId)?.abbreviation || pick.originalTeamId} ${pick.round === 1 ? "1st" : "2nd"} is no longer owned by ${state.context.teams.find(team => team.teamId === fromTeamId)?.teamName || fromTeamId}.`); continue; }
                if (pick.draftYear <= currentYear || pick.draftYear > currentYear + 5) { errors.push(`${pick.draftYear} is outside the supported future-pick window.`); continue; }
                if (pick.round === 2 && transfer.protection && transfer.protection !== "UNPROTECTED") errors.push("Second-round picks cannot have protection.");
                const chosenProtection = transfer.protection || pick.protection || "UNPROTECTED";
                if (chosenProtection !== pick.protection && (pick.currentOwnerTeamId !== pick.originalTeamId || (pick.ownershipHistory || []).length > 1)) errors.push("Protection is locked after the original pick is first traded.");
                if (!PICK_PROTECTIONS[chosenProtection]) { errors.push("Choose a valid first-round protection."); continue; }
                value = pickTradeValue({ round: pick.round, draftYear: pick.draftYear, currentYear, originalTeamId: pick.originalTeamId, outlooks: state.outlooks, protection: chosenProtection }).value;
            } else { errors.push(`Unsupported trade asset type ${assetType || "(empty)"}.`); continue; }
            assetCount += 1;
            sent.set(fromTeamId, sent.get(fromTeamId) + value);
            received.set(toTeamId, received.get(toTeamId) + value);
        }
        const teams = trade.participatingTeams.map(teamId => {
            const team = state.context.teams.find(candidate => candidate.teamId === teamId);
            const rosterSize = state.rosterByTeam.get(teamId)?.length || 0;
            const projectedRosterCount = rosterSize - playersOut.get(teamId) + playersIn.get(teamId);
            const difference = received.get(teamId) - sent.get(teamId);
            if (projectedRosterCount !== 15) errors.push(`${team?.teamName || teamId} would have ${projectedRosterCount} players; every team must finish with exactly 15.`);
            if (!options.skipValueRule && Math.abs(difference) > 50) errors.push(`${team?.teamName || teamId} is ${Math.abs(difference)} trade-value points outside the allowed range.`);
            if (!options.skipTradeCount && (currentCounts.get(teamId) || 0) >= 5) errors.push(`${team?.teamName || teamId} has already completed 5/5 trades.`);
            return { teamId, teamName: team?.teamName || teamId, sent: sent.get(teamId), received: received.get(teamId), difference, rosterCount: rosterSize, projectedRosterCount, tradeCount: currentCounts.get(teamId) || 0 };
        });
        if (!assetCount) errors.push("Add at least one player or draft pick to the trade.");
        return { valid: errors.length === 0, errors: [...new Set(errors)], teams, transfers, deadlineAllowed: withinNewTradeWindow || Boolean(trade.originSubmittedAt) };
    }

    function validateDeadline(state, existingSubmittedAt = null) {
        const week = Number(state.context.league.currentWeek);
        const withinWindow = state.context.league.currentPhase === "REGULAR_SEASON" && Number.isInteger(week) && week >= 1 && week <= 9;
        if (!withinWindow && !existingSubmittedAt) throw new Error(state.context.league.currentPhase === "PLAYOFFS" ? "Trading is closed during the playoffs." : "New trades may be submitted only through Week 9.");
    }

    function submitTrade({ leagueId, tradeId, actorUserId }) {
        const trade = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId);
        if (!trade || trade.status !== "DRAFT" || trade.initiatingUserId !== String(actorUserId)) throw new Error("This trade draft cannot be submitted by you.");
        const state = currentContext(leagueId, trade.seasonId);
        validateDeadline(state, trade.originSubmittedAt);
        const preview = thisPreview(leagueId, trade);
        if (!preview.valid) throw new Error(preview.errors.join("\n"));
        const ownersByTeam = new Map(state.owners.map(owner => [owner.teamId, owner]));
        if ((!state.settings.testMode || ownersByTeam.has(trade.initiatingTeamId)) && ownersByTeam.get(trade.initiatingTeamId)?.userId !== String(actorUserId)) throw new Error("Only the assigned coach for the initiating team may submit this proposal.");
        if (!state.settings.testMode && trade.participatingTeams.some(teamId => !ownersByTeam.get(teamId)?.userId)) throw new Error("Every participating team needs an assigned coach before submission.");
        const nowIso = timestamp();
        const gmDecisions = [{ teamId: trade.initiatingTeamId, userId: String(actorUserId), decision: "APPROVE", timestamp: nowIso, implicit: true }];
        const snapshot = {
            version: trade.version,
            submittedAt: nowIso,
            expiresAt: new Date(now() + RESPONSE_WINDOW_MS).toISOString(),
            participatingTeams: [...trade.participatingTeams],
            initiatingUserId: trade.initiatingUserId,
            initiatingTeamId: trade.initiatingTeamId,
            transfers: preview.transfers.map(transfer => {
                const record = { ...transfer };
                if (transfer.assetType === "PLAYER") {
                    const player = state.playerById.get(transfer.assetId), membership = state.membershipByPlayer.get(transfer.assetId);
                    record.playerId = player.playerId; record.playerName = player.name; record.teamIdAtSubmission = membership.teamId;
                    record.snapshotTradeValue = playerTradeValue({ ...player, position1: membership.position1 ?? player.position1, position2: membership.position2 ?? player.position2 }, state.context.seasonId);
                } else {
                    const pick = state.pickById.get(transfer.assetId);
                    record.pickId = pick.pickId; record.draftYear = pick.draftYear; record.round = pick.round;
                    record.originalTeamId = pick.originalTeamId; record.ownerAtSubmission = pick.currentOwnerTeamId;
                    record.protection = transfer.protection || pick.protection || "UNPROTECTED";
                    record.snapshotTradeValue = pickTradeValue({ round: pick.round, draftYear: pick.draftYear, currentYear: leagueSeasonStartYear(state.context.seasonId), originalTeamId: pick.originalTeamId, outlooks: state.outlooks, protection: record.protection }).value;
                }
                return record;
            }),
            teams: preview.teams.map(team => ({ ...team, snapshotSentValue: team.sent, snapshotReceivedValue: team.received, snapshotDifference: team.difference, coachUserId: ownersByTeam.get(team.teamId)?.userId || String(actorUserId), tradeCountAtSubmission: team.tradeCount })),
            gmDecisions,
            committee: null,
            proof: { channelId: null, threadId: null, submissions: [], rejections: [], staffDecision: null },
            processing: null,
        };
        trade.versions ||= [];
        if (trade.currentVersion) trade.versions.push(trade.currentVersion);
        trade.currentVersion = snapshot;
        trade.originSubmittedAt ||= nowIso;
        trade.submittedAt = nowIso;
        trade.expiresAt = snapshot.expiresAt;
        trade.coachUserIds = [...new Set(trade.participatingTeams.map(teamId => ownersByTeam.get(teamId)?.userId).filter(Boolean))];
        transition(leagueId, trade, "PENDING_GM_APPROVAL", actorUserId);
        return { trade: repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId), preview, snapshot };
    }

    function responseTeam(state, trade, actorTeamId, actorUserId) {
        if (!trade.participatingTeams.includes(actorTeamId)) throw new Error("You are not a coach for a team in this trade.");
        const owner = state.owners.find(entry => entry.teamId === actorTeamId);
        if ((!state.settings.testMode || owner) && owner?.userId !== String(actorUserId)) throw new Error("Only the current team coach may respond to this trade.");
        return owner;
    }

    function decideGM({ leagueId, tradeId, version, actorUserId, actorTeamId, decision, eligibleVoterIds = [] }) {
        const trade = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId);
        if (!trade || trade.status !== "PENDING_GM_APPROVAL" || trade.version !== Number(version)) throw new Error("This GM response is no longer active.");
        const state = currentContext(leagueId, trade.seasonId);
        responseTeam(state, trade, actorTeamId, actorUserId);
        if (actorTeamId === trade.initiatingTeamId) throw new Error("The proposer already approved by submitting this version.");
        if (!new Set(["APPROVE", "DENY"]).has(decision)) throw new Error("Choose Approve or Deny.");
        const decisions = trade.currentVersion.gmDecisions;
        if (decisions.some(entry => entry.teamId === actorTeamId)) throw new Error("Your team has already responded to this version.");
        if (decision === "DENY") {
            decisions.push({ teamId: actorTeamId, userId: String(actorUserId), decision, timestamp: timestamp() });
            trade.currentVersion.gmDecisions = decisions;
            trade.currentVersion.denialReason = "DENIED_BY_GM";
            transition(leagueId, trade, "DENIED_BY_GM", actorUserId, `Denied by ${actorTeamId}`);
            return { status: trade.status, committeeReady: false };
        }
        const nextDecisions = [...decisions, { teamId: actorTeamId, userId: String(actorUserId), decision, timestamp: timestamp() }];
        const approvedTeams = new Set(nextDecisions.filter(entry => entry.decision === "APPROVE").map(entry => entry.teamId));
        const requiredTeams = trade.participatingTeams.filter(teamId => teamId !== trade.initiatingTeamId);
        const allApproved = requiredTeams.every(teamId => approvedTeams.has(teamId));
        let committee = null;
        if (allApproved) {
            const involvedUsers = new Set(trade.currentVersion.teams.map(team => team.coachUserId).filter(Boolean));
            const eligible = [...new Set(eligibleVoterIds.map(String))].filter(userId => !involvedUsers.has(userId));
            if (!eligible.length) throw new Error("No eligible Trade Committee voters are available after excluding the involved coaches.");
            committee = { eligibleVoterIds: eligible, requiredVotes: Math.floor(eligible.length / 2) + 1, votes: [], startedAt: timestamp(), expiresAt: new Date(now() + RESPONSE_WINDOW_MS).toISOString(), result: null };
        }
        trade.currentVersion.gmDecisions = nextDecisions;
        if (committee) trade.currentVersion.committee = committee;
        transition(leagueId, trade, committee ? "PENDING_COMMITTEE" : "PENDING_GM_APPROVAL", actorUserId);
        if (committee) trade.expiresAt = committee.expiresAt;
        if (committee) repository.saveTrades(leagueId, repository.loadTrades(leagueId).map(entry => entry.tradeId === tradeId ? trade : entry));
        return { status: trade.status, committeeReady: Boolean(committee), committee };
    }

    function counterTrade({ leagueId, tradeId, version, actorUserId, actorTeamId }) {
        const trade = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId);
        if (!trade || trade.status !== "PENDING_GM_APPROVAL" || trade.version !== Number(version)) throw new Error("This trade can no longer be countered.");
        const state = currentContext(leagueId, trade.seasonId);
        responseTeam(state, trade, actorTeamId, actorUserId);
        if (actorTeamId === trade.initiatingTeamId) throw new Error("Only another involved team can counter this proposal.");
        trade.currentVersion.status = "COUNTERED";
        trade.currentVersion.counteredAt = timestamp();
        trade.versions ||= [];
        trade.versions.push(trade.currentVersion);
        trade.previousVersionId = `${trade.tradeId}:v${trade.version}`;
        trade.version += 1;
        trade.initiatingTeamId = actorTeamId;
        trade.initiatingUserId = String(actorUserId);
        trade.transfers = trade.currentVersion.transfers.map(transfer => ({ ...transfer }));
        trade.currentVersion = null;
        trade.expiresAt = null;
        transition(leagueId, trade, "DRAFT", actorUserId, "COUNTERED");
        return trade;
    }

    function voteCommittee({ leagueId, tradeId, version, actorUserId, decision }) {
        const trade = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId);
        if (!trade || trade.status !== "PENDING_COMMITTEE" || trade.version !== Number(version)) throw new Error("Committee voting is no longer open.");
        const committee = trade.currentVersion.committee;
        if (!committee.eligibleVoterIds.includes(String(actorUserId))) throw new Error("You are not an eligible voter for this trade.");
        if (!new Set(["APPROVE", "DENY"]).has(decision)) throw new Error("Choose Approve or Deny.");
        if (committee.votes.some(vote => vote.userId === String(actorUserId))) throw new Error("You have already voted on this trade.");
        committee.votes.push({ userId: String(actorUserId), decision, timestamp: timestamp() });
        const approve = committee.votes.filter(vote => vote.decision === "APPROVE").length;
        const deny = committee.votes.filter(vote => vote.decision === "DENY").length;
        if (approve >= committee.requiredVotes) {
            committee.result = { decision: "APPROVED", approve, deny, requiredVotes: committee.requiredVotes, completedAt: timestamp() };
            transition(leagueId, trade, "AWAITING_PROOF", actorUserId);
            trade.currentVersion.proof.expiresAt = new Date(now() + RESPONSE_WINDOW_MS).toISOString();
            trade.expiresAt = trade.currentVersion.proof.expiresAt;
            repository.saveTrades(leagueId, repository.loadTrades(leagueId).map(entry => entry.tradeId === tradeId ? trade : entry));
        } else if (deny >= committee.requiredVotes) {
            committee.result = { decision: "DENIED", approve, deny, requiredVotes: committee.requiredVotes, completedAt: timestamp() };
            transition(leagueId, trade, "DENIED_BY_COMMITTEE", actorUserId, "Committee majority denied the proposal");
        } else {
            repository.saveTrades(leagueId, repository.loadTrades(leagueId).map(entry => entry.tradeId === tradeId ? trade : entry));
            audit(leagueId, trade, "trade.committee.voted", actorUserId, { decision, approve, deny, requiredVotes: committee.requiredVotes });
        }
        return { status: trade.status, approve, deny, requiredVotes: committee.requiredVotes, result: committee.result };
    }

    function submitProof({ leagueId, tradeId, actorUserId, actorTeamId, attachment }) {
        const trade = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId);
        if (!trade || trade.status !== "AWAITING_PROOF") throw new Error("This trade is not accepting proof.");
        const state = currentContext(leagueId, trade.seasonId);
        responseTeam(state, trade, actorTeamId, actorUserId);
        if (Date.parse(trade.expiresAt) <= now()) throw new Error("The proof deadline has expired.");
        if (!attachment?.url || !attachment?.name) throw new Error("Upload one screenshot image in the trade's proof thread.");
        const proof = trade.currentVersion.proof;
        const submission = { attachment: { name: attachment.name, url: attachment.url, contentType: attachment.contentType || null, size: attachment.size || null, storagePath: attachment.storagePath || null }, submittedBy: String(actorUserId), submittedAt: timestamp() };
        proof.submissions.push(submission);
        proof.latestSubmission = submission;
        transition(leagueId, trade, "PENDING_PROOF_REVIEW", actorUserId);
        return { trade, submission };
    }

    function revalidateSnapshot(state, trade) {
        const snapshot = trade.currentVersion;
        const draft = { ...trade, participatingTeams: snapshot.participatingTeams, transfers: snapshot.transfers };
        const preview = thisPreview(trade.leagueId, draft, { skipValueRule: true });
        const ownershipErrors = preview.errors.filter(message => !/trade-value points outside/.test(message));
        const duplicates = new Set();
        for (const transfer of snapshot.transfers) {
            const key = `${transfer.assetType}:${transfer.assetId}`;
            if (duplicates.has(key)) ownershipErrors.push(`Duplicate asset ${transfer.assetId}.`);
            duplicates.add(key);
        }
        return { ...preview, valid: ownershipErrors.length === 0, errors: ownershipErrors };
    }

    function reviewProof({ leagueId, tradeId, version, actorUserId, approve }) {
        const trade = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId);
        if (trade?.status === "COMPLETED" && trade.version === Number(version) && trade.currentVersion?.proof?.staffDecision?.decision === "APPROVED") return { status: "COMPLETED", finalized: true, alreadyProcessed: true, invalidatedTrades: [] };
        if (!trade || trade.status !== "PENDING_PROOF_REVIEW" || trade.version !== Number(version)) throw new Error("This proof is no longer awaiting staff review.");
        if (approve !== true) {
            const proof = trade.currentVersion.proof;
            proof.rejections.push({ staffUserId: String(actorUserId), timestamp: timestamp() });
            proof.latestSubmission = null;
            transition(leagueId, trade, "AWAITING_PROOF", actorUserId, "PROOF_REJECTED");
            return { status: trade.status, finalized: false, expiresAt: trade.expiresAt };
        }
        const state = currentContext(leagueId, trade.seasonId);
        const validation = revalidateSnapshot(state, trade);
        if (!validation.valid) {
            trade.invalidReason = validation.errors.join(" ");
            trade.currentVersion.proof.staffDecision = { decision: "REJECTED", staffUserId: String(actorUserId), timestamp: timestamp(), reason: trade.invalidReason };
            transition(leagueId, trade, "INVALIDATED", actorUserId, trade.invalidReason);
            return { status: trade.status, finalized: false, invalidated: true, errors: validation.errors };
        }
        return finalizeTrade(leagueId, trade, actorUserId);
    }

    function finalizeTrade(leagueId, trade, actorUserId) {
        if (trade.status === "COMPLETED") return { status: trade.status, alreadyProcessed: true, invalidatedTrades: [] };
        if (trade.status !== "PENDING_PROOF_REVIEW" || trade.currentVersion.proof.latestSubmission == null) throw new Error("Approved proof is required before processing.");
        const validation = revalidateSnapshot(currentContext(leagueId, trade.seasonId), trade);
        if (!validation.valid) throw new Error(`Trade is no longer valid: ${validation.errors.join(" ")}`);
        const current = repository.loadTrades(leagueId);
        const playerRows = repository.loadPlayers(leagueId);
        const players = new Map(playerRows.map(player => [player.playerId, player]));
        const memberships = repository.loadRosterMemberships(leagueId);
        const picks = repository.loadDraftPicks(leagueId);
        const playerById = new Map(players);
        const movedPlayerIds = new Set(), movedPickIds = new Set();
        const completedAt = timestamp();
        for (const transfer of trade.currentVersion.transfers) {
            if (transfer.assetType === "PLAYER") {
                const membership = memberships.find(entry => entry.playerId === transfer.assetId && String(entry.seasonId) === String(trade.seasonId) && entry.active !== false && !entry.endedAt);
                const player = playerById.get(transfer.assetId);
                if (!membership || membership.teamId !== transfer.fromTeamId || !player || movedPlayerIds.has(transfer.assetId)) throw new Error(`Player ${transfer.assetId} changed ownership during processing.`);
                membership.ownershipHistory ||= [{ teamId: transfer.fromTeamId, action: "ROSTERED", timestamp: membership.importedAt || null, tradeId: null }];
                membership.ownershipHistory.push({ teamId: transfer.toTeamId, action: "TRADED", timestamp: completedAt, tradeId: trade.tradeId });
                membership.teamId = transfer.toTeamId; membership.updatedAt = completedAt;
                player.teamId = transfer.toTeamId; player.updatedAt = completedAt;
                movedPlayerIds.add(transfer.assetId);
            } else {
                const pick = picks.find(entry => entry.pickId === transfer.assetId);
                if (!pick || pick.currentOwnerTeamId !== transfer.fromTeamId || movedPickIds.has(transfer.assetId)) throw new Error(`Draft pick ${transfer.assetId} changed ownership during processing.`);
                if (pick.currentOwnerTeamId === pick.originalTeamId && (pick.ownershipHistory || []).length <= 1) pick.protection = transfer.protection || pick.protection || "UNPROTECTED";
                pick.ownershipHistory ||= [];
                pick.ownershipHistory.push({ teamId: transfer.toTeamId, action: "TRADED", timestamp: completedAt, tradeId: trade.tradeId, fromTeamId: transfer.fromTeamId, protection: pick.protection });
                pick.currentOwnerTeamId = transfer.toTeamId; pick.updatedAt = completedAt;
                movedPickIds.add(transfer.assetId);
            }
        }
        trade.status = "COMPLETED";
        trade.completedAt = completedAt;
        trade.expiresAt = null;
        trade.processingId = trade.processingId || randomUUID();
        trade.currentVersion.status = "COMPLETED";
        trade.currentVersion.proof.staffDecision = { decision: "APPROVED", staffUserId: String(actorUserId), timestamp: completedAt };
        trade.currentVersion.processing = { processingId: trade.processingId, processedAt: completedAt, affectedPlayerIds: [...movedPlayerIds], affectedPickIds: [...movedPickIds] };
        trade.history.push({ from: "PENDING_PROOF_REVIEW", to: "COMPLETED", actorUserId: String(actorUserId), timestamp: completedAt, version: trade.version });
        const assetOwners = new Map(trade.currentVersion.transfers.map(transfer => [`${transfer.assetType}:${transfer.assetId}`, transfer.toTeamId]));
        const invalidatedTrades = [];
        const updatedTrades = current.map(entry => {
            if (entry.tradeId === trade.tradeId || !ACTIVE_STATUSES.has(entry.status)) return entry.tradeId === trade.tradeId ? trade : entry;
            const stale = (entry.currentVersion?.transfers || []).find(transfer => assetOwners.has(`${transfer.assetType}:${transfer.assetId}`) && assetOwners.get(`${transfer.assetType}:${transfer.assetId}`) !== transfer.fromTeamId);
            if (!stale) return entry;
            const previousStatus = entry.status;
            entry.status = "INVALIDATED"; entry.invalidReason = `ASSET_MOVED_BY_${trade.tradeId}`; entry.expiresAt = null; entry.updatedAt = completedAt;
            entry.history ||= []; entry.history.push({ from: previousStatus, to: "INVALIDATED", actorUserId: String(actorUserId), reason: entry.invalidReason, timestamp: completedAt, version: entry.version });
            invalidatedTrades.push({ tradeId: entry.tradeId, participatingTeams: entry.participatingTeams, reason: entry.invalidReason });
            return entry;
        });
        const auditEntry = { action: "trade.completed", userId: String(actorUserId), leagueId, seasonId: trade.seasonId, tradeId: trade.tradeId, version: trade.version, timestamp: completedAt, metadata: { teams: trade.participatingTeams, affectedPlayerIds: [...movedPlayerIds], affectedPickIds: [...movedPickIds], processingId: trade.processingId, invalidatedTrades: invalidatedTrades.map(entry => entry.tradeId) } };
        repository.commitTradeTransaction({ leagueId, players: playerRows, rosterMemberships: memberships, draftPicks: picks, trades: updatedTrades, auditEntry });
        if (movedPlayerIds.size && onPlayersMoved) {
            try { Promise.resolve(onPlayersMoved({ leagueId, seasonId: trade.seasonId, playerIds: [...movedPlayerIds], reason: "PLAYER_TRADED" })).catch(error => console.error("Upgrade request invalidation after trade failed:", error.message)); }
            catch (error) { console.error("Upgrade request invalidation after trade failed:", error.message); }
        }
        return { status: "COMPLETED", processingId: trade.processingId, invalidatedTrades };
    }

    function recordDiscordReference({ leagueId, tradeId, version, kind, channelId, messageId, threadId = null }) {
        const trade = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId);
        if (!trade || trade.version !== Number(version) || !trade.currentVersion) throw new Error("This trade version is no longer active.");
        const target = kind === "proof" ? trade.currentVersion.proof : kind === "committee" ? trade.currentVersion.committee : null;
        if (!target) throw new Error("Discord reference does not match a trade stage.");
        if (channelId) target.channelId = String(channelId);
        if (messageId) target.messageId = String(messageId);
        if (threadId) target.threadId = String(threadId);
        repository.saveTrades(leagueId, repository.loadTrades(leagueId).map(entry => entry.tradeId === tradeId ? trade : entry));
        return trade;
    }

    function expireDue(leagueId, seasonId) {
        const expired = [];
        for (const trade of repository.loadTrades(leagueId)) {
            if (!ACTIVE_STATUSES.has(trade.status) || trade.status === "PENDING_PROOF_REVIEW" || !trade.expiresAt || Date.parse(trade.expiresAt) > now()) continue;
            const status = trade.status === "PENDING_GM_APPROVAL" ? "EXPIRED_GM_RESPONSE" : trade.status === "PENDING_COMMITTEE" ? "EXPIRED_COMMITTEE" : "EXPIRED_PROOF";
            if (seasonId && String(trade.seasonId) !== String(seasonId)) continue;
            transition(leagueId, trade, status, "system", status);
            expired.push({ tradeId: trade.tradeId, status, participatingTeams: trade.participatingTeams });
        }
        return expired;
    }

    return {
        createDraft,
        counterTrade,
        decideGM,
        expireDue,
        exclusive,
        getLiveSnapshot,
        getTrade(leagueId, tradeId) { return repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId) || null; },
        getTradeByProofThread(leagueId, threadId) { return repository.loadTrades(leagueId).find(entry => entry.status === "AWAITING_PROOF" && entry.currentVersion?.proof?.threadId === String(threadId)) || null; },
        initializeDraftPicks,
        previewDraft(leagueId, tradeId) { const trade = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId); if (!trade) throw new Error("Unknown trade."); return thisPreview(leagueId, trade); },
        reviewProof,
        repository,
        recordDiscordReference,
        submitProof,
        submitTrade,
        tradeCounts,
        updateDraft,
        voteCommittee,
    };
}

module.exports = { ACTIVE_STATUSES, RESPONSE_WINDOW_MS, createTradeService };