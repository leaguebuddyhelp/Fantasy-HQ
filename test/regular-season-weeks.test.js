const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFantasyHQRepository } = require("../src/fantasyhq/repository");
const { createLeagueService } = require("../src/fantasyhq/league-service");
const { generateSchedule } = require("../src/fantasyhq/schedule-generator");

function fixture(t) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leaguebuddy-weeks-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const repository = createFantasyHQRepository({ dataRoot });
  const teams = ["East", "West"].flatMap(conference => Array.from({ length: 15 }, (_, i) => ({
    teamId: `${conference}-${i}`, teamName: `${conference} ${i}`,
    abbreviation: `${conference[0]}${i}`, conference,
  })));
  const args = { leagueId: "test", seasonId: "1", validator: () => ({ ready: true }) };
  repository.saveLeague("test", { currentPhase: "PRESEASON", currentSeasonId: "1" });
  repository.saveTeams("test", teams);
  repository.saveSchedule(generateSchedule({ ...args, teams }));
  return { repository, args, service: createLeagueService({ repository }) };
}

test("regular-season initialization preserves all games and byes and is a no-op on retries", t => {
  const { repository, args, service } = fixture(t);
  const before = repository.loadSchedule("test", "1");
  const league = service.startRegularSeason(args);
  assert.equal(league.currentPhase, "REGULAR_SEASON");
  assert.equal(league.currentWeek, 1);
  const initialized = repository.loadSchedule("test", "1");
  assert.equal(initialized.weeks.length, 15);
  assert.deepEqual(initialized.weeks.map(w => w.weekNumber), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(new Set(initialized.weeks.map(w => w.weekId)).size, 15);
  assert.equal(initialized.weeks.filter(w => w.status === "ACTIVE").length, 1);
  for (const week of initialized.weeks) {
    assert.equal(week.leagueId, "test");
    assert.equal(week.seasonId, "1");
    assert.equal(week.status, week.weekNumber === 1 ? "ACTIVE" : "UPCOMING");
    assert.equal(week.games.length, 14);
    assert.equal(week.byes.length, 2);
    const original = before.weeks.find(w => w.week === week.weekNumber);
    assert.deepEqual(week.games, original.games);
    assert.deepEqual(week.byes, original.byes);
  }
  const games = initialized.weeks.flatMap(w => w.games);
  assert.equal(games.length, 210);
  assert.equal(new Set(games.map(g => [g.team1Id, g.team2Id].sort().join(":"))).size, 210);
  assert.equal(initialized.generatedAt, before.generatedAt);
  service.initializeRegularSeasonWeeks(args);
  service.startRegularSeason(args);
  assert.deepEqual(repository.loadSchedule("test", "1"), initialized);
  assert.deepEqual(repository.loadLeague("test").league, league);
  assert.equal(repository.loadAuditLog("test").filter(e => e.action === "league.regular-season.started").length, 1);
});

test("invalid saved schedules fail before the league phase or week state changes", async t => {
  const cases = [
    ["missing week", s => s.weeks.pop()],
    ["duplicate week number", s => { s.weeks[1].week = 1; }],
    ["out-of-range week", s => { s.weeks[14].week = 16; }],
    ["duplicate game", s => { s.weeks[0].games[1] = { ...s.weeks[0].games[0] }; }],
    ["missing game", s => s.weeks[0].games.pop()],
    ["missing bye", s => s.weeks[0].byes.pop()],
    ["duplicate week ID", s => { s.weeks[0].weekId = s.weeks[1].weekId = "duplicate"; }],
    ["conflicting identity", s => { s.weeks[0].weekNumber = 2; }],
    ["multiple active weeks", s => { s.weeks[0].status = s.weeks[1].status = "ACTIVE"; }],
  ];
  for (const [name, change] of cases) await t.test(name, sub => {
    const { repository, args, service } = fixture(sub);
    const schedule = repository.loadSchedule("test", "1");
    change(schedule);
    repository.saveSchedule(schedule);
    const before = repository.loadSchedule("test", "1");
    const league = repository.loadLeague("test").league;
    assert.throws(() => service.startRegularSeason(args));
    assert.deepEqual(repository.loadSchedule("test", "1"), before);
    assert.deepEqual(repository.loadLeague("test").league, league);
    assert.equal(repository.loadAuditLog("test").length, 0);
  });
});

test("initialization rejects another season, wrong phases, and progressed seasons", t => {
  const { repository, args, service } = fixture(t);
  assert.throws(() => service.initializeRegularSeasonWeeks({ ...args, seasonId: "2" }), /current season/);
  repository.saveLeague("test", { currentPhase: "SETUP" });
  assert.throws(() => service.initializeRegularSeasonWeeks(args), /PRESEASON/);
  repository.saveLeague("test", { currentPhase: "REGULAR_SEASON", currentWeek: 2 });
  const before = repository.loadSchedule("test", "1");
  assert.throws(() => service.initializeRegularSeasonWeeks(args), /progressed/);
  assert.deepEqual(repository.loadSchedule("test", "1"), before);
});

test("a schedule persistence failure leaves the league in preseason and can be retried", t => {
  const { repository, args, service } = fixture(t);
  const saveSchedule = repository.saveSchedule;
  repository.saveSchedule = () => { throw new Error("write failed"); };
  assert.throws(() => service.startRegularSeason(args), /write failed/);
  assert.equal(repository.loadLeague("test").league.currentPhase, "PRESEASON");
  assert.equal(repository.loadLeague("test").league.currentWeek, null);
  repository.saveSchedule = saveSchedule;
  service.startRegularSeason(args);
  assert.equal(repository.loadLeague("test").league.currentPhase, "REGULAR_SEASON");
});
