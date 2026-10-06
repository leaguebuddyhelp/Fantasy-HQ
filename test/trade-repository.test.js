const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFantasyHQRepository } = require("../src/fantasyhq/repository");

test("trade JSON persistence and interrupted multi-file transaction recovery", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lb-trade-repository-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    repository.saveLeague("league", { currentSeasonId: "1" });
    repository.saveDraftPicks("league", [{ pickId: "pick-1", currentOwnerTeamId: "atl" }]);
    repository.saveTrades("league", [{ tradeId: "trade-1", status: "DRAFT" }]);
    assert.equal(repository.loadDraftPicks("league")[0].pickId, "pick-1");
    assert.equal(repository.loadTrades("league")[0].status, "DRAFT");

    const journal = path.join(repository.buildLeaguePaths(root, "league").leagueRoot, "trade-transaction.json");
    fs.writeFileSync(journal, JSON.stringify({
        leagueId: "league", files: [
            { name: "players.json", value: [{ playerId: "p1", name: "Player" }] },
            { name: "roster-memberships.json", value: [{ playerId: "p1", teamId: "bos", seasonId: "1" }] },
            { name: "draft-picks.json", value: [{ pickId: "pick-1", currentOwnerTeamId: "bos" }] },
            { name: "trades.json", value: [{ tradeId: "trade-1", status: "COMPLETED" }] },
            { name: "audit-log.json", value: [{ action: "trade.completed" }] },
        ]
    }));

    assert.equal(repository.loadPlayers("league")[0].playerId, "p1");
    assert.equal(repository.loadRosterMemberships("league")[0].teamId, "bos");
    assert.equal(repository.loadDraftPicks("league")[0].currentOwnerTeamId, "bos");
    assert.equal(repository.loadTrades("league")[0].status, "COMPLETED");
    assert.equal(repository.loadAuditLog("league")[0].action, "trade.completed");
    assert.equal(fs.existsSync(journal), false);
});

test("player upgrade transaction recovers player and upgrade state together", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lb-upgrade-repository-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    repository.saveLeague("league", { currentSeasonId: "1" });
    const paths = repository.buildLeaguePaths(root, "league");
    fs.mkdirSync(paths.leagueRoot, { recursive: true });
    const journal = path.join(paths.leagueRoot, "player-upgrade-transaction.json");
    fs.writeFileSync(journal, JSON.stringify({
        leagueId: "league", files: [
            { name: "players.json", value: [{ playerId: "p1", overall: 86, weightLbs: 224 }] },
            { name: "player-upgrades.json", value: { requests: [{ requestId: "request-1", status: "COMPLETED" }] } },
            { name: "audit-log.json", value: [{ action: "player.upgrade.completed" }] },
        ],
    }));

    const recovered = createFantasyHQRepository({ dataRoot: root });
    assert.deepEqual(recovered.loadPlayers("league"), [{ playerId: "p1", overall: 86, weightLbs: 224 }]);
    assert.deepEqual(recovered.loadPlayerUpgradeState("league"), { requests: [{ requestId: "request-1", status: "COMPLETED" }] });
    assert.equal(recovered.loadAuditLog("league")[0].action, "player.upgrade.completed");
    assert.equal(fs.existsSync(journal), false);
});