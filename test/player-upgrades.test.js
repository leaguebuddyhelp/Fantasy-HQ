const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { NORMAL_CATEGORIES, SPECIAL_UPGRADES, validateNormalUpgrade } = require("../src/fantasyhq/player-upgrades-service");
const { createPlayerUpgradeService } = require("../src/fantasyhq/player-upgrades-service");
const { createFantasyHQRepository } = require("../src/fantasyhq/repository");
const { PHASES } = require("../src/fantasyhq/constants");
const { createRosterService } = require("../src/fantasyhq/roster-service");
const { createPlayerService } = require("../src/fantasyhq/player-service");

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lb-player-upgrades-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    repository.saveLeague("league", { currentSeasonId: "2026", seasonNumber: 1, currentPhase: PHASES.REGULAR_SEASON, guildId: "guild" });
    repository.saveTeams("league", [
        { teamId: "bos", teamName: "Boston Celtics", abbreviation: "BOS", conference: "East" },
        { teamId: "nyk", teamName: "New York Knicks", abbreviation: "NYK", conference: "East" },
    ]);
    const owners = [{ teamId: "bos", userId: "coach-bos" }, { teamId: "nyk", userId: "coach-nyk" }];
    repository.saveOwners("league", owners);
    repository.savePlayers("league", [
        { playerId: "player-bos", name: "Boston Player", overall: 80, archetype: "Arc Finisher", weightLbs: 224, birthdate: "2000-01-01" },
        { playerId: "player-nyk", name: "New York Player", overall: 78, archetype: "Stretch Five", weightLbs: 240, birthdate: "2000-01-01" },
    ]);
    repository.saveRosterMemberships("league", [
        { leagueId: "league", seasonId: "2026", teamId: "bos", playerId: "player-bos", active: true },
        { leagueId: "league", seasonId: "2026", teamId: "nyk", playerId: "player-nyk", active: true },
    ]);
    const schedule = {
        leagueId: "league", seasonId: "2026", weeks: Array.from({ length: 15 }, (_, index) => ({
            week: index + 1,
            weekId: `week-${index + 1}`,
            games: [{ team1Id: "bos", team2Id: "nyk" }],
            byes: [],
        }))
    };
    repository.saveSchedule(schedule);
    const records = [];
    let clock = Date.parse("2026-10-01T12:00:00.000Z");
    const notifications = [];
    const service = createPlayerUpgradeService({
        repository,
        submissions: { records: () => records },
        now: () => clock,
        onUpgradeAvailable: notice => notifications.push(notice),
    });
    service.syncOwnerSnapshot({ leagueId: "league", seasonId: "2026", owners, phase: PHASES.REGULAR_SEASON });

    function addGame(gameId, week, { mode = "TEAM_SIDES", playedTeams = ["bos", "nyk"], participants = { bos: "coach-bos", nyk: "coach-nyk" } } = {}) {
        const submissionId = `submission-${gameId}`;
        const timestamp = new Date(clock).toISOString();
        records.push({
            game: { gameId, leagueId: "league", seasonId: "2026", weekId: `week-${week}`, weekNumber: week, team1Id: "bos", team2Id: "nyk", status: "FINAL", finalizedAt: timestamp, result: { submissionId, extractionId: `extraction-${gameId}`, scores: { bos: 101, nyk: 99 } } },
            submissions: [{ submissionId, mode, status: "FINAL", createdAt: timestamp, participants }],
            extractions: [{ extractionId: `extraction-${gameId}`, submissionId, status: "READY_FOR_REVIEW", issues: [] }],
            playerGameStats: playedTeams.flatMap(teamId => [{ gameId, teamId, playerId: teamId === "bos" ? "player-bos" : "player-nyk", MIN: 1 }]),
            dnpPlayers: [],
        });
        clock += 1000;
    }

    return { repository, service, records, notifications, owners, schedule, addGame, setClock: value => { clock = value; } };
}

function normalRequest(service, { source = "GAME_EARNED", playerId = "player-bos", teamId = "bos", coachUserId = "coach-bos", category = "REBOUNDING", allocations = [{ attribute: "Offensive Rebound", points: 1 }], owners } = {}) {
    return service.createRequest({ leagueId: "league", seasonId: "2026", teamId, coachUserId, source, type: "NORMAL", playerId, category, allocations, phase: PHASES.REGULAR_SEASON, owners });
}

function complete(service, request) {
    return service.completeRequest({ leagueId: "league", requestId: request.requestId, staffUserId: "staff", staffAuthorized: true, phase: PHASES.REGULAR_SEASON });
}

test("normal upgrade categories and special choices match the league rules", () => {
    assert.equal(Object.keys(NORMAL_CATEGORIES).length, 8);
    assert.deepEqual(NORMAL_CATEGORIES.PLAYMAKING, ["Ball Handle", "Speed With Ball", "Pass", "Pass IQ", "Vision"]);
    assert.equal(Object.keys(SPECIAL_UPGRADES).length, 3);
    assert.equal(SPECIAL_UPGRADES["STRENGTH TRAINING"].weightLbs, 8);
    assert.deepEqual(SPECIAL_UPGRADES.CONDITIONING.attributes, ["Speed +1", "Agility +1", "Vertical +1", "Stamina +3"]);
    assert.deepEqual(SPECIAL_UPGRADES["X-FACTOR"].attributes, ["Potential +3"]);
    assert.ok(!Object.hasOwn(NORMAL_CATEGORIES, "ATHLETICISM"));
});

test("normal allocations allow one through five points and cap an attribute at three", () => {
    assert.deepEqual(validateNormalUpgrade("SHOOTING", [{ attribute: "3PT", points: 3 }, { attribute: "Mid Range", points: 2 }]), {
        category: "SHOOTING",
        allocations: [{ attribute: "3PT", points: 3 }, { attribute: "Mid Range", points: 2 }],
        pointsUsed: 5,
    });
    assert.equal(validateNormalUpgrade("DEFENSE", [{ attribute: "Steal", points: 1 }]).pointsUsed, 1);
    assert.throws(() => validateNormalUpgrade("SHOOTING", [{ attribute: "3PT", points: 4 }]), /between \+1 and \+3/);
});

test("normal allocations reject invalid totals, categories, attributes and duplicates", () => {
    assert.throws(() => validateNormalUpgrade("SHOOTING", [{ attribute: "3PT", points: 3 }, { attribute: "FT", points: 3 }]), /at most five/);
    assert.throws(() => validateNormalUpgrade("ATHLETICISM", [{ attribute: "Speed", points: 1 }]), /eight normal/);
    assert.throws(() => validateNormalUpgrade("SHOOTING", [{ attribute: "Speed", points: 1 }]), /not in SHOOTING/);
    assert.throws(() => validateNormalUpgrade("PLAYMAKING", [{ attribute: "Pass", points: 1 }, { attribute: "Pass", points: 1 }]), /only be allocated once/);
    assert.throws(() => validateNormalUpgrade("REBOUNDING", []), /at least one/);
});

test("each finalized coach-submitted true game counts once and awards every fourth game", t => {
    const f = fixture(t);
    for (let week = 1; week <= 12; week += 1) f.addGame(`game-${week}`, week);
    assert.equal(f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" }).awards.length, 6);
    assert.equal(f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" }).awards.length, 0);
    const status = f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON });
    assert.equal(status.qualifyingGames, 12);
    assert.equal(status.gameEarnedAvailable, 3);
    assert.equal(status.special.status, "AVAILABLE");
    assert.equal(f.notifications.filter(notice => notice.coachUserId === "coach-bos" && notice.kind === "GAME_EARNED").length, 3);
});

test("qualifying games one through three persist independently and game four awards once", t => {
    const f = fixture(t);
    for (let week = 1; week <= 3; week += 1) {
        f.addGame(`incremental-game-${week}`, week);
        f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
        assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON }).qualifyingGames, week);
        assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON }).gameEarnedAvailable, 0);
        assert.equal(f.notifications.filter(notice => notice.kind === "GAME_EARNED").length, 0);
    }
    f.addGame("incremental-game-4", 4);
    const result = f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    assert.equal(result.gamesCounted, 2);
    assert.equal(result.awards.filter(award => award.coachUserId === "coach-bos").length, 1);
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON }).gameEarnedAvailable, 1);
    assert.equal(f.notifications.filter(notice => notice.kind === "GAME_EARNED").length, 2);
});

test("staff submissions, forfeits without player rows, and DNP-only teams do not earn games", t => {
    const f = fixture(t);
    f.addGame("staff-game", 1, { mode: "STAFF_BOTH" });
    f.addGame("dnp-game", 2, { playedTeams: ["nyk"] });
    f.addGame("no-result-game", 3);
    f.records[2].game.result = null;
    f.records[2].game.status = "SCHEDULED";
    assert.equal(f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" }).awards.length, 0);
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON }).qualifyingGames, 0);
});

test("duplicate finalized records for one scheduled matchup do not award either game ID", t => {
    const f = fixture(t);
    f.addGame("duplicate-a", 1);
    f.addGame("duplicate-b", 1);
    assert.equal(f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" }).gamesCounted, 0);
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON }).qualifyingGames, 0);
});

test("coach replacement resets tenure progress, expires unused balance, and grants one New User Upgrade", t => {
    const f = fixture(t);
    for (let week = 1; week <= 4; week += 1) f.addGame(`before-change-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const nextOwners = [{ teamId: "bos", userId: "coach-new" }, { teamId: "nyk", userId: "coach-nyk" }];
    f.repository.saveOwners("league", nextOwners);
    f.service.syncOwnerSnapshot({ leagueId: "league", seasonId: "2026", owners: nextOwners, phase: PHASES.REGULAR_SEASON });
    const status = f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-new", phase: PHASES.REGULAR_SEASON });
    assert.equal(status.qualifyingGames, 0);
    assert.equal(status.gameEarnedAvailable, 0);
    assert.equal(status.newUserStatus, "AVAILABLE");
    assert.equal(f.notifications.filter(notice => notice.coachUserId === "coach-new" && notice.kind === "NEW_USER").length, 1);
    assert.equal(f.notifications.filter(notice => notice.coachUserId === "coach-bos" && notice.kind === "GAME_EARNED").length, 1);
    const request = normalRequest(f.service, { source: "NEW_USER", coachUserId: "coach-new", owners: nextOwners });
    complete(f.service, request);
    assert.throws(() => normalRequest(f.service, { source: "NEW_USER", coachUserId: "coach-new" }), /No New User Upgrade/);
    const history = f.service.playerEligibility({ leagueId: "league", seasonId: "2026", teamId: "bos" });
    assert.equal(history.find(player => player.playerId === "player-bos").completedUpgradeCount, 1);
});

test("removing and re-adding the same coach cannot issue another New User Upgrade", t => {
    const f = fixture(t), newcomer = [{ teamId: "bos", userId: "coach-new" }, { teamId: "nyk", userId: "coach-nyk" }];
    f.service.syncOwnerSnapshot({ leagueId: "league", seasonId: "2026", owners: newcomer, phase: PHASES.REGULAR_SEASON });
    const original = [{ teamId: "bos", userId: "coach-bos" }, { teamId: "nyk", userId: "coach-nyk" }];
    f.service.syncOwnerSnapshot({ leagueId: "league", seasonId: "2026", owners: original, phase: PHASES.REGULAR_SEASON });
    f.service.syncOwnerSnapshot({ leagueId: "league", seasonId: "2026", owners: newcomer, phase: PHASES.REGULAR_SEASON });
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-new", phase: PHASES.REGULAR_SEASON }).newUserStatus, "NOT_ELIGIBLE");
    assert.equal(f.repository.loadPlayerUpgradeState("league").newUserEntitlements.filter(entry => entry.coachUserId === "coach-new").length, 1);
});

test("a team can have only one active request while banking additional upgrades", t => {
    const f = fixture(t);
    for (let week = 1; week <= 8; week += 1) f.addGame(`banked-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const first = normalRequest(f.service);
    assert.throws(() => normalRequest(f.service, { category: "SHOOTING", allocations: [{ attribute: "3PT", points: 1 }] }), /already has an active/);
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON }).gameEarnedAvailable, 2);
    f.service.rejectRequest({ leagueId: "league", requestId: first.requestId, staffUserId: "staff", staffAuthorized: true });
    assert.doesNotThrow(() => normalRequest(f.service, { category: "SHOOTING", allocations: [{ attribute: "3PT", points: 1 }] }));
});

test("failed upgrade DMs do not undo persisted game-earned balances", t => {
    const f = fixture(t);
    f.service.setNotificationHandler(() => { throw new Error("DMs disabled"); });
    for (let week = 1; week <= 4; week += 1) f.addGame(`dm-failure-game-${week}`, week);
    assert.doesNotThrow(() => f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" }));
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON }).gameEarnedAvailable, 1);
});

test("New User upgrade cannot be used for a Special and Staff approval revalidates limits", t => {
    const f = fixture(t);
    const nextOwners = [{ teamId: "bos", userId: "coach-new" }, { teamId: "nyk", userId: "coach-nyk" }];
    f.repository.saveOwners("league", nextOwners);
    f.service.syncOwnerSnapshot({ leagueId: "league", seasonId: "2026", owners: nextOwners, phase: PHASES.REGULAR_SEASON });
    for (let week = 1; week <= 4; week += 1) f.addGame(`new-coach-game-${week}`, week, { participants: { bos: "coach-new", nyk: "coach-nyk" } });
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    assert.throws(() => f.service.createRequest({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-new", source: "NEW_USER", type: "SPECIAL", playerId: "player-bos", specialType: "CONDITIONING", phase: PHASES.REGULAR_SEASON }), /only be used for a normal/);
    const request = normalRequest(f.service, { source: "NEW_USER", coachUserId: "coach-new" });
    assert.throws(() => f.service.completeRequest({ leagueId: "league", requestId: request.requestId, staffUserId: "coach-new", staffAuthorized: false, phase: PHASES.REGULAR_SEASON }), /Only configured league Staff/);
    complete(f.service, request);
    const other = normalRequest(f.service, { source: "GAME_EARNED", coachUserId: "coach-new", category: "SHOOTING", allocations: [{ attribute: "3PT", points: 1 }] });
    complete(f.service, other);
    assert.equal(f.service.playerEligibility({ leagueId: "league", seasonId: "2026", teamId: "bos" }).find(player => player.playerId === "player-bos").completedUpgradeCount, 2);
    assert.throws(() => normalRequest(f.service, { source: "NEW_USER", coachUserId: "coach-new", category: "DEFENSE", allocations: [{ attribute: "Steal", points: 1 }] }), /two-upgrade season limit/);
    const memberships = f.repository.loadRosterMemberships("league");
    memberships.find(entry => entry.playerId === "player-bos" && entry.seasonId === "2026").teamId = "nyk";
    f.repository.saveRosterMemberships("league", memberships);
    const afterMove = f.service.playerEligibility({ leagueId: "league", seasonId: "2026", teamId: "nyk" }).find(player => player.playerId === "player-bos");
    assert.equal(afterMove.completedUpgradeCount, 2);
    assert.equal(afterMove.maxed, true);
});

test("game-earned Special consumes one upgrade, records changes, applies weight once, and locks all Specials", t => {
    const f = fixture(t);
    for (let week = 1; week <= 8; week += 1) f.addGame(`special-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const request = f.service.createRequest({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", source: "GAME_EARNED", type: "SPECIAL", playerId: "player-bos", specialType: "STRENGTH TRAINING", phase: PHASES.REGULAR_SEASON });
    complete(f.service, request);
    assert.equal(f.repository.loadPlayers("league").find(player => player.playerId === "player-bos").weightLbs, 232);
    assert.throws(() => f.service.createRequest({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", source: "GAME_EARNED", type: "SPECIAL", playerId: "player-bos", specialType: "X-FACTOR", phase: PHASES.REGULAR_SEASON }), /already used its Special/);
    const status = f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON });
    assert.equal(status.gameEarnedAvailable, 1);
    assert.equal(status.special.status, "USED");
    const changedOwners = [{ teamId: "bos", userId: "coach-new" }, { teamId: "nyk", userId: "coach-nyk" }];
    f.repository.saveOwners("league", changedOwners);
    f.service.syncOwnerSnapshot({ leagueId: "league", seasonId: "2026", owners: changedOwners, phase: PHASES.REGULAR_SEASON });
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-new", phase: PHASES.REGULAR_SEASON }).special.status, "USED");
});

test("Staff rejection preserves the source and releases the team's request lock", t => {
    const f = fixture(t);
    for (let week = 1; week <= 4; week += 1) f.addGame(`reject-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const request = normalRequest(f.service);
    f.service.rejectRequest({ leagueId: "league", requestId: request.requestId, staffUserId: "staff", staffAuthorized: true });
    const status = f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON });
    assert.equal(status.gameEarnedAvailable, 1);
    assert.throws(() => f.service.rejectRequest({ leagueId: "league", requestId: request.requestId, staffUserId: "staff", staffAuthorized: true }), /no longer pending/);
    assert.doesNotThrow(() => normalRequest(f.service));
});

test("same normal category cannot repeat, but another category can; changed OVR/build are snapshotted", t => {
    const f = fixture(t);
    for (let week = 1; week <= 8; week += 1) f.addGame(`build-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const beforeValue = require("../src/fantasyhq/asset-valuation").playerTradeValue(f.repository.loadPlayers("league")[0], "2026");
    const first = normalRequest(f.service, { category: "REBOUNDING" });
    const completed = f.service.completeRequest({ leagueId: "league", requestId: first.requestId, staffUserId: "staff", staffAuthorized: true, phase: PHASES.REGULAR_SEASON, changeMode: "BOTH_CHANGED", newOverall: 85, newBuild: "Stretch Five" });
    assert.equal(completed.before.overall, 80);
    assert.equal(completed.after.overall, 85);
    assert.equal(completed.before.archetype, "Arc Finisher");
    assert.equal(completed.after.archetype, "Stretch Five");
    assert.notEqual(completed.before.tradeValue, completed.after.tradeValue);
    assert.throws(() => normalRequest(f.service, { category: "REBOUNDING" }), /already used that normal category/);
    assert.doesNotThrow(() => normalRequest(f.service, { category: "SHOOTING", allocations: [{ attribute: "3PT", points: 1 }] }));
    const savedPlayer = f.repository.loadPlayers("league").find(player => player.playerId === "player-bos");
    assert.equal(require("../src/fantasyhq/asset-valuation").playerTradeValue(savedPlayer, "2026") > beforeValue, true);
});

test("each Staff OVR/build approval mode uses stored before-values and only requested fields change", t => {
    const cases = [
        { mode: "NO_CHANGE", overall: 80, archetype: "Arc Finisher" },
        { mode: "OVR_CHANGED", newOverall: 84, overall: 84, archetype: "Arc Finisher" },
        { mode: "BUILD_CHANGED", newBuild: "Stretch Five", overall: 80, archetype: "Stretch Five" },
        { mode: "BOTH_CHANGED", newOverall: 85, newBuild: "Stretch Five", overall: 85, archetype: "Stretch Five" },
    ];
    for (const [index, scenario] of cases.entries()) {
        const f = fixture(t);
        for (let week = 1; week <= 4; week += 1) f.addGame(`approval-${index}-${week}`, week);
        f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
        const request = normalRequest(f.service);
        const completed = f.service.completeRequest({ leagueId: "league", requestId: request.requestId, staffUserId: "staff", staffAuthorized: true, phase: PHASES.REGULAR_SEASON, changeMode: scenario.mode, newOverall: scenario.newOverall, newBuild: scenario.newBuild });
        assert.equal(completed.before.overall, 80);
        assert.equal(completed.before.archetype, "Arc Finisher");
        assert.equal(completed.after.overall, scenario.overall);
        assert.equal(completed.after.archetype, scenario.archetype);
    }
});

test("new regular season resets player and Special limits while preserving historical requests", t => {
    const f = fixture(t);
    for (let week = 1; week <= 8; week += 1) f.addGame(`reset-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const special = f.service.createRequest({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", source: "GAME_EARNED", type: "SPECIAL", playerId: "player-bos", specialType: "X-FACTOR", phase: PHASES.REGULAR_SEASON });
    complete(f.service, special);
    f.repository.saveRosterMemberships("league", [...f.repository.loadRosterMemberships("league"),
    { leagueId: "league", seasonId: "2027", teamId: "bos", playerId: "player-bos", active: true },
    { leagueId: "league", seasonId: "2027", teamId: "nyk", playerId: "player-nyk", active: true },
    ]);
    f.repository.saveLeague("league", { currentSeasonId: "2027", seasonNumber: 2, currentPhase: PHASES.REGULAR_SEASON });
    f.service.handlePhase({ leagueId: "league", seasonId: "2027", phase: PHASES.REGULAR_SEASON, owners: f.repository.loadOwners("league") });
    const status = f.service.getStatus({ leagueId: "league", seasonId: "2027", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON });
    assert.equal(status.qualifyingGames, 0);
    assert.equal(status.gameEarnedAvailable, 0);
    assert.equal(status.special.status, "LOCKED_UNTIL_FOUR_GAMES");
    assert.equal(f.service.playerEligibility({ leagueId: "league", seasonId: "2027", teamId: "bos" }).find(player => player.playerId === "player-bos").completedUpgradeCount, 0);
    assert.equal(f.service.history({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos" }).find(entry => entry.requestId === special.requestId).status, "COMPLETED");
});

test("playoff New User entitlement stays locked and activates for the next regular season", t => {
    const f = fixture(t), nextOwners = [{ teamId: "bos", userId: "coach-new" }, { teamId: "nyk", userId: "coach-nyk" }];
    f.service.syncOwnerSnapshot({ leagueId: "league", seasonId: "2026", owners: nextOwners, phase: PHASES.PLAYOFFS });
    f.service.handlePhase({ leagueId: "league", seasonId: "2026", phase: PHASES.PLAYOFFS });
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-new", phase: PHASES.PLAYOFFS }).newUserStatus, "LOCKED_UNTIL_REGULAR_SEASON");
    f.repository.saveRosterMemberships("league", [...f.repository.loadRosterMemberships("league"),
    { leagueId: "league", seasonId: "2027", teamId: "bos", playerId: "player-bos", active: true },
    { leagueId: "league", seasonId: "2027", teamId: "nyk", playerId: "player-nyk", active: true },
    ]);
    f.repository.saveLeague("league", { currentSeasonId: "2027", seasonNumber: 2, currentPhase: PHASES.REGULAR_SEASON });
    f.service.handlePhase({ leagueId: "league", seasonId: "2027", phase: PHASES.REGULAR_SEASON, owners: nextOwners });
    const status = f.service.getStatus({ leagueId: "league", seasonId: "2027", teamId: "bos", coachUserId: "coach-new", phase: PHASES.REGULAR_SEASON });
    assert.equal(status.newUserStatus, "AVAILABLE");
    assert.equal(status.qualifyingGames, 0);
});

test("season rollover expires an old pending request and keeps its historical ledger state", t => {
    const f = fixture(t);
    for (let week = 1; week <= 4; week += 1) f.addGame(`rollover-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const request = normalRequest(f.service);
    f.repository.saveRosterMemberships("league", [...f.repository.loadRosterMemberships("league"),
    { leagueId: "league", seasonId: "2027", teamId: "bos", playerId: "player-bos", active: true },
    { leagueId: "league", seasonId: "2027", teamId: "nyk", playerId: "player-nyk", active: true },
    ]);
    f.repository.saveLeague("league", { currentSeasonId: "2027", seasonNumber: 2, currentPhase: PHASES.REGULAR_SEASON });
    f.service.handlePhase({ leagueId: "league", seasonId: "2027", phase: PHASES.REGULAR_SEASON, owners: f.repository.loadOwners("league") });
    const state = f.repository.loadPlayerUpgradeState("league");
    assert.equal(state.requests.find(entry => entry.requestId === request.requestId).status, "EXPIRED");
    assert.equal(state.requests.find(entry => entry.requestId === request.requestId).expirationReason, "SEASON_CHANGED");
    assert.equal(f.service.playerEligibility({ leagueId: "league", seasonId: "2027", teamId: "bos" }).find(player => player.playerId === "player-bos").completedUpgradeCount, 0);
});

test("traded or released players expire pending requests without spending the earned upgrade", t => {
    const f = fixture(t);
    for (let week = 1; week <= 4; week += 1) f.addGame(`movement-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const request = normalRequest(f.service);
    assert.equal(f.service.invalidatePlayerRequests({ leagueId: "league", seasonId: "2026", playerIds: ["player-bos"], reason: "PLAYER_TRADED" }), true);
    const saved = f.repository.loadPlayerUpgradeState("league").requests.find(entry => entry.requestId === request.requestId);
    assert.equal(saved.status, "EXPIRED");
    assert.equal(saved.expirationReason, "PLAYER_TRADED");
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON }).gameEarnedAvailable, 1);
});

test("requests are blocked when the persisted league phase is not regular season", t => {
    const f = fixture(t);
    f.repository.saveLeague("league", { currentPhase: PHASES.PLAYOFFS });
    assert.throws(() => f.service.createRequest({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", source: "NEW_USER", type: "NORMAL", playerId: "player-bos", category: "SHOOTING", allocations: [{ attribute: "3PT", points: 1 }], phase: PHASES.PLAYOFFS }), /active season during the regular season/);
});

test("phase-locked recovery does not award late-discovered games during playoffs", t => {
    const f = fixture(t);
    for (let week = 1; week <= 4; week += 1) f.addGame(`late-playoff-game-${week}`, week);
    f.repository.saveLeague("league", { currentPhase: PHASES.PLAYOFFS });
    assert.equal(f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" }).gamesCounted, 0);
    assert.equal(f.service.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.PLAYOFFS }).qualifyingGames, 0);
});

test("restart reconciliation expires a pending request after an unobserved player trade", t => {
    const f = fixture(t);
    for (let week = 1; week <= 4; week += 1) f.addGame(`recovery-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const request = normalRequest(f.service), memberships = f.repository.loadRosterMemberships("league");
    memberships.find(entry => entry.playerId === "player-bos" && entry.seasonId === "2026").teamId = "nyk";
    f.repository.saveRosterMemberships("league", memberships);
    const restarted = createPlayerUpgradeService({ repository: f.repository, submissions: { records: () => f.records }, now: () => Date.parse("2026-10-06T12:00:00.000Z") });
    const expired = restarted.reconcilePendingRequests({ leagueId: "league" });
    assert.equal(expired.length, 1);
    assert.equal(expired[0].requestId, request.requestId);
    assert.equal(expired[0].expirationReason, "PLAYER_TRADED");
    assert.equal(restarted.getStatus({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", phase: PHASES.REGULAR_SEASON }).gameEarnedAvailable, 1);
});

test("existing roster release and admin team movement hooks invalidate pending requests", t => {
    const f = fixture(t);
    for (let week = 1; week <= 4; week += 1) f.addGame(`roster-hook-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const releasedRequest = normalRequest(f.service);
    const roster = createRosterService({ repository: f.repository, onRosterMovement: event => f.service.invalidatePlayerRequests(event) });
    roster.removePlayer({ leagueId: "league", seasonId: "2026", playerId: "player-bos", teamId: "bos", actingUserId: "staff" });
    assert.equal(f.repository.loadPlayerUpgradeState("league").requests.find(entry => entry.requestId === releasedRequest.requestId).expirationReason, "PLAYER_NO_LONGER_ON_ROSTER");
    const movedRequest = normalRequest(f.service, { playerId: "player-nyk", teamId: "nyk", coachUserId: "coach-nyk" });
    const players = createPlayerService({ repository: f.repository, onRosterMovement: event => f.service.invalidatePlayerRequests(event) });
    players.updatePlayer({ leagueId: "league", seasonId: "2026", playerId: "player-nyk", patch: { teamId: "bos" }, actingUserId: "staff" });
    assert.equal(f.repository.loadPlayerUpgradeState("league").requests.find(entry => entry.requestId === movedRequest.requestId).expirationReason, "PLAYER_NO_LONGER_ON_ROSTER");
});

test("pending requests expire on playoffs or player movement without consuming balances", t => {
    const f = fixture(t);
    for (let week = 1; week <= 4; week += 1) f.addGame(`pending-game-${week}`, week);
    f.service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });
    const request = normalRequest(f.service);
    f.service.handlePhase({ leagueId: "league", seasonId: "2026", phase: PHASES.PLAYOFFS });
    assert.throws(() => complete(f.service, request), /no longer pending/);
    const state = f.repository.loadPlayerUpgradeState("league");
    assert.equal(state.requests.find(entry => entry.requestId === request.requestId).expirationReason, "PLAYOFFS_STARTED");
    assert.equal(state.tenures.find(tenure => tenure.teamId === "bos" && tenure.seasonId === "2026").spentGameUpgrades, 0);
});