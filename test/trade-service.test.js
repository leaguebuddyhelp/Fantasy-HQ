const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFantasyHQRepository } = require("../src/fantasyhq/repository");
const { createTradeService, RESPONSE_WINDOW_MS } = require("../src/fantasyhq/trade-service");

function fixture(t, { week = 4, phase = "REGULAR_SEASON", testMode = false, onPlayersMoved = null } = {}) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "lb-trade-service-")), root = testMode ? path.join(base,"simulations","fixture","workspace") : base;
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    const teamIds = ["alpha", "bravo", "charlie"];
    const teams = teamIds.map((teamId, index) => ({ teamId, teamName: `${teamId} team`, abbreviation: teamId.toUpperCase(), conference: index === 0 ? "East" : "West" }));
    repository.saveLeague("league", { currentPhase: phase, currentSeasonId: "1", seasonNumber: 1, currentWeek: week });
    repository.saveTeams("league", teams);
    repository.saveGuildLeagueBinding("guild", { leagueId: "league", seasonId: "1" });
    repository.saveSettings("league", { testMode, ...(testMode?{simulationId:'fixture'}:{}), discordChannels: {} });
    repository.saveOwners("league", teamIds.map(teamId => ({ teamId, userId: `coach-${teamId}` })));
    const players = [], memberships = [];
    for (const teamId of teamIds) for (let index = 0; index < 15; index += 1) {
        const playerId = `${teamId}-player-${index}`;
        players.push({ playerId, leagueId: "league", name: `${teamId} player ${index}`, overall: 80, birthdate: "2000-01-01", position1: "SF", height: "6'7\"", wingspan: "7'0\"", yearsInNBA: 5 });
        memberships.push({ leagueId: "league", seasonId: "1", teamId, playerId, active: true });
    }
    repository.savePlayers("league", players);
    repository.saveRosterMemberships("league", memberships);
    repository.saveSchedule({ leagueId: "league", seasonId: "1", weeks: Array.from({ length: 15 }, (_, index) => ({ week: index + 1, weekId: `week-${index + 1}`, status: index + 1 === week ? "ACTIVE" : index + 1 < week ? "COMPLETED" : "UPCOMING", games: [], byes: [] })) });
    let currentTime = Date.UTC(2026, 9, 1);
    const service = createTradeService({ repository, now: () => currentTime, onPlayersMoved });
    service.initializeDraftPicks({ leagueId: "league", seasonId: "1" });
    function createTwoTeamDraft() {
        const trade = service.createDraft({ leagueId: "league", seasonId: "1", initiatingUserId: "coach-alpha", initiatingTeamId: "alpha", secondTeamId: "bravo" });
        service.updateDraft({
            leagueId: "league", tradeId: trade.tradeId, actorUserId: "coach-alpha", transfers: [
                { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "bravo" },
                { assetType: "PLAYER", assetId: "bravo-player-0", fromTeamId: "bravo", toTeamId: "alpha" },
            ]
        });
        return trade;
    }
    return { repository, service, teams, teamIds, players, createTwoTeamDraft, advance(ms) { currentTime += ms; return currentTime; }, time: () => currentTime };
}

test("2-team and 3-team previews enforce every team's exact roster and value balance", t => {
    const f = fixture(t);
    const two = f.createTwoTeamDraft();
    assert.equal(f.service.previewDraft("league", two.tradeId).valid, true);
    const three = f.service.createDraft({ leagueId: "league", seasonId: "1", initiatingUserId: "coach-alpha", initiatingTeamId: "alpha", secondTeamId: "bravo" });
    f.service.updateDraft({
        leagueId: "league", tradeId: three.tradeId, actorUserId: "coach-alpha", participatingTeams: ["alpha", "bravo", "charlie"], transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "bravo" },
            { assetType: "PLAYER", assetId: "bravo-player-0", fromTeamId: "bravo", toTeamId: "charlie" },
            { assetType: "PLAYER", assetId: "charlie-player-0", fromTeamId: "charlie", toTeamId: "alpha" },
        ]
    });
    assert.equal(f.service.previewDraft("league", three.tradeId).valid, true);
    f.service.updateDraft({
        leagueId: "league", tradeId: three.tradeId, actorUserId: "coach-alpha", transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "bravo" },
            { assetType: "PLAYER", assetId: "bravo-player-0", fromTeamId: "bravo", toTeamId: "charlie" },
        ]
    });
    const invalid = f.service.previewDraft("league", three.tradeId);
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some(error => /charlie team would have 16 players/.test(error)));
    f.service.updateDraft({
        leagueId: "league", tradeId: three.tradeId, actorUserId: "coach-alpha", transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "bravo" },
            { assetType: "PLAYER", assetId: "bravo-player-0", fromTeamId: "bravo", toTeamId: "alpha" },
            { assetType: "PLAYER", assetId: "alpha-player-1", fromTeamId: "alpha", toTeamId: "charlie" },
            { assetType: "PLAYER", assetId: "charlie-player-0", fromTeamId: "charlie", toTeamId: "alpha" },
            { assetType: "PLAYER", assetId: "bravo-player-1", fromTeamId: "bravo", toTeamId: "alpha" },
        ]
    });
    assert.ok(f.service.previewDraft("league", three.tradeId).errors.some(error => /alpha team would have 16 players/.test(error)));
});

test("draft picks do not affect roster counts and protection is retained on downstream transfers", t => {
    const f = fixture(t);
    const picks = f.repository.loadDraftPicks("league");
    assert.equal(picks.length, 30);
    const alphaPick = picks.find(pick => pick.originalTeamId === "alpha" && pick.round === 1);
    const bravoPick = picks.find(pick => pick.originalTeamId === "bravo" && pick.round === 1);
    const trade = f.service.createDraft({ leagueId: "league", seasonId: "1", initiatingUserId: "coach-alpha", initiatingTeamId: "alpha", secondTeamId: "bravo" });
    f.service.updateDraft({
        leagueId: "league", tradeId: trade.tradeId, actorUserId: "coach-alpha", transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "bravo" },
            { assetType: "PLAYER", assetId: "bravo-player-0", fromTeamId: "bravo", toTeamId: "alpha" },
            { assetType: "PICK", assetId: alphaPick.pickId, fromTeamId: "alpha", toTeamId: "bravo", protection: "TOP_5" },
            { assetType: "PICK", assetId: bravoPick.pickId, fromTeamId: "bravo", toTeamId: "alpha", protection: "TOP_5" },
        ]
    });
    const preview = f.service.previewDraft("league", trade.tradeId);
    assert.deepEqual(preview.teams.map(team => team.projectedRosterCount), [15, 15]);
    assert.equal(preview.valid, true);
});

test("submission freezes values, counter creates a new version and resets approvals and timer", t => {
    const f = fixture(t), draft = f.createTwoTeamDraft();
    const submitted = f.service.submitTrade({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha" });
    const oldValue = submitted.snapshot.transfers[0].snapshotTradeValue;
    f.repository.savePlayers("league", f.repository.loadPlayers("league").map(player => ["alpha-player-0", "bravo-player-0"].includes(player.playerId) ? { ...player, overall: 95 } : player));
    const oldExpiry = Date.parse(submitted.trade.expiresAt);
    f.advance(1000);
    f.service.counterTrade({ leagueId: "league", tradeId: draft.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo" });
    f.service.updateDraft({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-bravo" });
    const countered = f.service.submitTrade({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-bravo" });
    assert.equal(countered.snapshot.version, 2);
    assert.ok(countered.snapshot.transfers.find(transfer => transfer.assetId === "alpha-player-0").snapshotTradeValue > oldValue);
    assert.equal(countered.snapshot.gmDecisions.length, 1);
    assert.ok(Date.parse(countered.trade.expiresAt) > oldExpiry);
    assert.equal(countered.trade.versions[0].status, "COUNTERED");
});

test("GM denial and persisted deadlines resolve without entering committee", t => {
    const f = fixture(t), draft = f.createTwoTeamDraft();
    const { trade } = f.service.submitTrade({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha" });
    const denied = f.service.decideGM({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo", decision: "DENY" });
    assert.equal(denied.status, "DENIED_BY_GM");
    const expiring = f.createTwoTeamDraft();
    f.service.submitTrade({ leagueId: "league", tradeId: expiring.tradeId, actorUserId: "coach-alpha" });
    f.advance(RESPONSE_WINDOW_MS + 1);
    assert.deepEqual(f.service.expireDue("league", "1").map(result => result.status), ["EXPIRED_GM_RESPONSE"]);
});

test("committee thresholds are strict majorities and voters are eligible only once", t => {
    for (const [eligible, expected] of [[5, 3], [4, 3], [3, 2], [2, 2], [1, 1]]) {
        const f = fixture(t, { testMode: true });
        const draft = f.createTwoTeamDraft();
        const { trade } = f.service.submitTrade({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha" });
        const voters = Array.from({ length: eligible }, (_, index) => `voter-${eligible}-${index}`);
        const result = f.service.decideGM({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo", decision: "APPROVE", eligibleVoterIds: voters });
        assert.equal(result.committee.requiredVotes, expected);
        assert.throws(() => f.service.voteCommittee({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-alpha", decision: "APPROVE" }), /eligible voter/);
        for (let index = 0; index < expected; index += 1) f.service.voteCommittee({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: voters[index], decision: "APPROVE" });
        assert.equal(f.service.getTrade("league", trade.tradeId).status, "AWAITING_PROOF");
        assert.throws(() => f.service.voteCommittee({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: voters[0], decision: "APPROVE" }), /no longer open/);
    }
});

test("proof rejection preserves its original deadline; approved proof commits exactly once", t => {
    const f = fixture(t), draft = f.createTwoTeamDraft();
    const { trade } = f.service.submitTrade({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha" });
    f.service.decideGM({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo", decision: "APPROVE", eligibleVoterIds: ["reviewer-a"] });
    f.service.voteCommittee({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "reviewer-a", decision: "APPROVE" });
    const deadline = f.service.getTrade("league", trade.tradeId).expiresAt;
    f.service.submitProof({ leagueId: "league", tradeId: trade.tradeId, actorUserId: "coach-bravo", actorTeamId: "bravo", attachment: { name: "proof.png", url: "https://example.test/proof.png" } });
    f.advance(RESPONSE_WINDOW_MS + 1);
    assert.deepEqual(f.service.expireDue("league", "1"), []);
    const rejected = f.service.reviewProof({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "staff-1", approve: false });
    assert.equal(rejected.status, "AWAITING_PROOF");
    assert.equal(rejected.expiresAt, deadline);
});

test("staff proof approval atomically moves players and protected picks, counts once, and invalidates stale offers", t => {
    const moved = [], f = fixture(t, { onPlayersMoved: event => moved.push(event) });
    const alphaPick = f.repository.loadDraftPicks("league").find(pick => pick.originalTeamId === "alpha" && pick.round === 1);
    const bravoPick = f.repository.loadDraftPicks("league").find(pick => pick.originalTeamId === "bravo" && pick.round === 1);
    const first = f.createTwoTeamDraft();
    f.service.updateDraft({
        leagueId: "league", tradeId: first.tradeId, actorUserId: "coach-alpha", transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "bravo" },
            { assetType: "PLAYER", assetId: "bravo-player-0", fromTeamId: "bravo", toTeamId: "alpha" },
            { assetType: "PICK", assetId: alphaPick.pickId, fromTeamId: "alpha", toTeamId: "bravo", protection: "TOP_5" },
            { assetType: "PICK", assetId: bravoPick.pickId, fromTeamId: "bravo", toTeamId: "alpha", protection: "TOP_5" },
        ]
    });
    const conflicting = f.service.createDraft({ leagueId: "league", seasonId: "1", initiatingUserId: "coach-alpha", initiatingTeamId: "alpha", secondTeamId: "charlie" });
    f.service.updateDraft({
        leagueId: "league", tradeId: conflicting.tradeId, actorUserId: "coach-alpha", transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "charlie" },
            { assetType: "PLAYER", assetId: "charlie-player-0", fromTeamId: "charlie", toTeamId: "alpha" },
        ]
    });
    f.service.submitTrade({ leagueId: "league", tradeId: conflicting.tradeId, actorUserId: "coach-alpha" });
    const { trade } = f.service.submitTrade({ leagueId: "league", tradeId: first.tradeId, actorUserId: "coach-alpha" });
    assert.deepEqual([...f.service.tradeCounts("league", "1").values()], [0, 0, 0]);
    f.service.decideGM({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo", decision: "APPROVE", eligibleVoterIds: ["coach-alpha", "coach-bravo", "reviewer"] });
    f.service.voteCommittee({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "reviewer", decision: "APPROVE" });
    f.service.submitProof({ leagueId: "league", tradeId: trade.tradeId, actorUserId: "coach-bravo", actorTeamId: "bravo", attachment: { name: "proof.png", url: "https://example.test/proof.png" } });
    const committed = f.service.reviewProof({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "staff-1", approve: true });
    assert.equal(committed.status, "COMPLETED");
    assert.equal(f.repository.loadRosterMemberships("league").find(entry => entry.playerId === "alpha-player-0").teamId, "bravo");
    assert.equal(f.repository.loadPlayers("league").find(player => player.playerId === "alpha-player-0").teamId, "bravo");
    assert.equal(f.repository.loadDraftPicks("league").find(pick => pick.pickId === alphaPick.pickId).currentOwnerTeamId, "bravo");
    assert.equal(f.repository.loadDraftPicks("league").find(pick => pick.pickId === alphaPick.pickId).protection, "TOP_5");
    assert.deepEqual([...f.service.tradeCounts("league", "1").values()], [1, 1, 0]);
    assert.equal(f.service.getTrade("league", conflicting.tradeId).status, "INVALIDATED");
    assert.equal(f.service.reviewProof({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "staff-1", approve: true }).alreadyProcessed, true);
    assert.equal(f.repository.loadRosterMemberships("league").find(entry => entry.playerId === "alpha-player-0").ownershipHistory.filter(entry => entry.action === "TRADED").length, 1);
    assert.equal(moved.length, 1);
    assert.deepEqual(new Set(moved[0].playerIds), new Set(["alpha-player-0", "bravo-player-0"]));
    assert.equal(moved[0].reason, "PLAYER_TRADED");
});

test("pre-deadline proposals can finish after Week 9; new Week 10 and playoff submissions fail", t => {
    const f = fixture(t, { week: 9 }), draft = f.createTwoTeamDraft();
    const { trade } = f.service.submitTrade({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha" });
    f.repository.saveLeague("league", { currentWeek: 10 });
    assert.equal(f.service.decideGM({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo", decision: "APPROVE", eligibleVoterIds: ["committee"] }).status, "PENDING_COMMITTEE");
    const lateDraft = f.createTwoTeamDraft();
    assert.throws(() => f.service.submitTrade({ leagueId: "league", tradeId: lateDraft.tradeId, actorUserId: "coach-alpha" }), /through Week 9/);
    f.repository.saveLeague("league", { currentPhase: "PLAYOFFS" });
    assert.throws(() => f.service.submitTrade({ leagueId: "league", tradeId: lateDraft.tradeId, actorUserId: "coach-alpha" }), /playoffs/);
});

test("a completed three-team trade increments all participants exactly once", t => {
    const f = fixture(t);
    const draft = f.service.createDraft({ leagueId: "league", seasonId: "1", initiatingUserId: "coach-alpha", initiatingTeamId: "alpha", secondTeamId: "bravo" });
    f.service.updateDraft({
        leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha", participatingTeams: ["alpha", "bravo", "charlie"], transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "bravo" },
            { assetType: "PLAYER", assetId: "bravo-player-0", fromTeamId: "bravo", toTeamId: "charlie" },
            { assetType: "PLAYER", assetId: "charlie-player-0", fromTeamId: "charlie", toTeamId: "alpha" },
        ]
    });
    const { trade } = f.service.submitTrade({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha" });
    const voters = ["coach-alpha", "coach-bravo", "coach-charlie", "reviewer"];
    f.service.decideGM({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo", decision: "APPROVE", eligibleVoterIds: voters });
    f.service.decideGM({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-charlie", actorTeamId: "charlie", decision: "APPROVE", eligibleVoterIds: voters });
    f.service.voteCommittee({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "reviewer", decision: "APPROVE" });
    f.service.submitProof({ leagueId: "league", tradeId: trade.tradeId, actorUserId: "coach-charlie", actorTeamId: "charlie", attachment: { name: "proof.png", url: "https://example.test/proof.png" } });
    assert.equal(f.service.reviewProof({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "staff", approve: true }).status, "COMPLETED");
    assert.deepEqual([...f.service.tradeCounts("league", "1").values()], [1, 1, 1]);
});

test("5/5 teams are blocked and committee/proof deadlines expire without consuming trades", t => {
    const f = fixture(t);
    f.repository.saveTrades("league", Array.from({ length: 5 }, (_, index) => ({ tradeId: `done-${index}`, leagueId: "league", seasonId: "1", status: "COMPLETED", participatingTeams: ["alpha"] })));
    const blocked = f.createTwoTeamDraft();
    assert.ok(f.service.previewDraft("league", blocked.tradeId).errors.some(error => /5\/5 trades/.test(error)));
    f.repository.saveTrades("league", []);
    const committeeDraft = f.createTwoTeamDraft();
    const { trade } = f.service.submitTrade({ leagueId: "league", tradeId: committeeDraft.tradeId, actorUserId: "coach-alpha" });
    f.service.decideGM({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo", decision: "APPROVE", eligibleVoterIds: ["reviewer"] });
    f.advance(RESPONSE_WINDOW_MS + 1);
    assert.equal(f.service.expireDue("league", "1")[0].status, "EXPIRED_COMMITTEE");
    const proofDraft = f.createTwoTeamDraft();
    const proofTrade = f.service.submitTrade({ leagueId: "league", tradeId: proofDraft.tradeId, actorUserId: "coach-alpha" }).trade;
    f.service.decideGM({ leagueId: "league", tradeId: proofTrade.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo", decision: "APPROVE", eligibleVoterIds: ["reviewer"] });
    f.service.voteCommittee({ leagueId: "league", tradeId: proofTrade.tradeId, version: 1, actorUserId: "reviewer", decision: "APPROVE" });
    f.advance(RESPONSE_WINDOW_MS + 1);
    assert.equal(f.service.expireDue("league", "1")[0].status, "EXPIRED_PROOF");
    assert.deepEqual([...f.service.tradeCounts("league", "1").values()], [0, 0, 0]);
});

test("proof approval invalidates a proposal whose player ownership became stale", t => {
    const f = fixture(t), draft = f.createTwoTeamDraft();
    const { trade } = f.service.submitTrade({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha" });
    f.service.decideGM({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo", decision: "APPROVE", eligibleVoterIds: ["reviewer"] });
    f.service.voteCommittee({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "reviewer", decision: "APPROVE" });
    f.service.submitProof({ leagueId: "league", tradeId: trade.tradeId, actorUserId: "coach-bravo", actorTeamId: "bravo", attachment: { name: "proof.png", url: "https://example.test/proof.png" } });
    f.repository.saveRosterMemberships("league", f.repository.loadRosterMemberships("league").map(entry => entry.playerId === "alpha-player-0" ? { ...entry, teamId: "charlie" } : entry));
    const result = f.service.reviewProof({ leagueId: "league", tradeId: trade.tradeId, version: 1, actorUserId: "staff", approve: true });
    assert.equal(result.status, "INVALIDATED");
    assert.deepEqual([...f.service.tradeCounts("league", "1").values()], [0, 0, 0]);
}); test('mock simulations refresh only after successful proof-backed current first-round transfers', t => {
    const f = fixture(t), service = f.service, file = path.join(f.repository.buildLeaguePaths(f.repository.dataRoot, 'league').leagueRoot, 'mock-draft', 'refresh.json');
    const trade = service.createDraft({ leagueId: 'league', seasonId: '1', initiatingUserId: 'coach-alpha', initiatingTeamId: 'alpha', secondTeamId: 'bravo' });
    service.updateDraft({
        leagueId: 'league', tradeId: trade.tradeId, actorUserId: 'coach-alpha', transfers: [
            { assetType: 'PICK', assetId: 'pick_2027_1_alpha', fromTeamId: 'alpha', toTeamId: 'bravo' },
            { assetType: 'PICK', assetId: 'pick_2027_1_bravo', fromTeamId: 'bravo', toTeamId: 'alpha' },
        ]
    });
    service.submitTrade({ leagueId: 'league', tradeId: trade.tradeId, actorUserId: 'coach-alpha' });
    assert.equal(fs.existsSync(file), false);
    service.decideGM({ leagueId: 'league', tradeId: trade.tradeId, version: 1, actorUserId: 'coach-bravo', actorTeamId: 'bravo', decision: 'APPROVE', eligibleVoterIds: ['voter'] });
    service.voteCommittee({ leagueId: 'league', tradeId: trade.tradeId, version: 1, actorUserId: 'voter', decision: 'APPROVE' });
    assert.equal(fs.existsSync(file), false);
    service.submitProof({ leagueId: 'league', tradeId: trade.tradeId, actorUserId: 'coach-alpha', actorTeamId: 'alpha', attachment: { name: 'proof.png', url: 'https://example.com/proof.png' } });
    assert.equal(fs.existsSync(file), false);
    const result = service.reviewProof({ leagueId: 'league', tradeId: trade.tradeId, version: 1, actorUserId: 'staff', approve: true });
    assert.equal(result.status, 'COMPLETED');
    assert.equal(f.repository.loadDraftPicks('league').find(p => p.pickId === 'pick_2027_1_alpha').currentOwnerTeamId, 'bravo');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).events[0].id, `trade:${result.processingId}`);
    service.reviewProof({ leagueId: 'league', tradeId: trade.tradeId, version: 1, actorUserId: 'staff', approve: true });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).events.length, 1);
});


test('test mode still requires actual online owners to submit and respond', t => {
  const f = fixture(t, { testMode: true }), draft = f.createTwoTeamDraft();
  assert.throws(() => f.service.submitTrade({ leagueId: 'league', tradeId: draft.tradeId, actorUserId: 'stranger' }), /cannot be submitted/);
  const owners = f.repository.loadOwners('league');
  f.repository.saveOwners('league', owners.map(o => o.teamId === 'alpha' ? { ...o, userId: 'replacement' } : o));
  assert.throws(() => f.service.submitTrade({ leagueId: 'league', tradeId: draft.tradeId, actorUserId: 'coach-alpha' }), /assigned coach/);
  f.repository.saveOwners('league', owners);
  const { trade } = f.service.submitTrade({ leagueId: 'league', tradeId: draft.tradeId, actorUserId: 'coach-alpha' });
  assert.throws(() => f.service.decideGM({ leagueId: 'league', tradeId: trade.tradeId, version: 1, actorUserId: 'coach-alpha', actorTeamId: 'bravo', decision: 'APPROVE' }), /current team coach/);
  f.service.decideGM({ leagueId: 'league', tradeId: trade.tradeId, version: 1, actorUserId: 'coach-bravo', actorTeamId: 'bravo', decision: 'APPROVE', eligibleVoterIds: ['independent'] });
});

test('legacy canonical testMode cannot submit a vacant-team trade as a Staff simulation',t=>{
 const f=fixture(t),draft=f.createTwoTeamDraft();f.repository.saveSettings('league',{testMode:true});f.repository.saveOwners('league',[]);assert.throws(()=>f.service.submitTrade({leagueId:'league',tradeId:draft.tradeId,actorUserId:'coach-alpha'}),/assigned coach|assigned/);
});
