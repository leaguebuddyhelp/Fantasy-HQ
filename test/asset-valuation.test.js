const test = require("node:test");
const assert = require("node:assert/strict");
const { leagueAge, playerTradeValue, evaluatePlayerTradeValue, pickTradeValue, teamOutlooks } = require("../src/fantasyhq/asset-valuation");

test("league age freezes to October 20 and changes only with the league season", () => {
    assert.equal(leagueAge("2000-10-20", 1), 26);
    assert.equal(leagueAge("2000-10-21", 1), 25);
    assert.equal(leagueAge("2000-10-19", 2), 27);
    assert.equal(leagueAge("2027-10-21", 1), null);
});

test("player value is deterministic, nonlinear by OVR, and excludes performance fields", () => {
    const make = (overall, stats = {}) => ({ overall, birthdate: "2004-01-01", position1: "SF", height: "6'8\"", wingspan: "7'2\"", yearsInNBA: 2, ...stats });
    const values = [75, 80, 90, 95].map(overall => playerTradeValue(make(overall), 1));
    assert.ok(values[3] - values[2] > values[1] - values[0]);
    assert.equal(playerTradeValue(make(90, { PPG: 50, RPG: 30, shooting: 1 }), 1), playerTradeValue(make(90), 1));
    assert.equal(playerTradeValue(make(90, { tradeValue: 1, manualTradeValue: 1300 }), 1), playerTradeValue(make(90), 1));
    assert.equal(playerTradeValue(make(90), 1), playerTradeValue(make(90), 1));
    assert.ok(values[3] > 1000 && values[3] < 1600);
    assert.notEqual(playerTradeValue(make(90), 2), playerTradeValue(make(90), 1));
});

test("age, positional size, and wingspan are normalized instead of globally rewarded", () => {
    const wing = { overall: 84, birthdate: "2004-01-01", position1: "SF", height: "6'8\"", wingspan: "7'2\"" };
    const oldSmallGuard = { overall: 84, birthdate: "1993-01-01", position1: "PG", height: "6'1\"", wingspan: "6'3\"" };
    assert.ok(playerTradeValue(wing, 1) > playerTradeValue(oldSmallGuard, 1));
    const undersizedCenter = { ...wing, position1: "C", position2: "PF" };
    assert.ok(playerTradeValue(wing, 1) > playerTradeValue(undersizedCenter, 1));
    const longerWing = { ...wing, wingspan: "7'6\"" };
    assert.ok(playerTradeValue(longerWing, 1) > playerTradeValue(wing, 1));
    assert.equal(evaluatePlayerTradeValue(wing, 1).components.contractModifier, 1);
});

test("pick values use original-team outlook, round, year and protection", () => {
    const teams = [{ teamId: "strong" }, { teamId: "weak" }];
    const outlooks = teamOutlooks(teams, new Map([
        ["strong", Array.from({ length: 15 }, () => ({ overall: 90, position1: "SF" }))],
        ["weak", Array.from({ length: 15 }, () => ({ overall: 70, position1: "SF" }))],
    ]), new Map(), 1, 1);
    const options = { round: 1, draftYear: 2027, currentYear: 2026, outlooks };
    const strongPick = pickTradeValue({ ...options, originalTeamId: "strong" });
    const weakPick = pickTradeValue({ ...options, originalTeamId: "weak" });
    assert.ok(weakPick.value > strongPick.value);
    assert.ok(pickTradeValue({ ...options, originalTeamId: "weak", draftYear: 2030 }).value < weakPick.value);
    assert.ok(pickTradeValue({ ...options, originalTeamId: "weak", protection: "UNPROTECTED" }).value > pickTradeValue({ ...options, originalTeamId: "weak", protection: "TOP_10" }).value);
    assert.ok(pickTradeValue({ ...options, round: 2, originalTeamId: "weak" }).value < weakPick.value);
    assert.equal(pickTradeValue({ ...options, originalTeamId: "weak" }).value, pickTradeValue({ ...options, originalTeamId: "weak", currentOwnerTeamId: "strong" }).value);
});