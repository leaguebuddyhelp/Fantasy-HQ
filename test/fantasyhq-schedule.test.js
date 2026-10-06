const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { generateSchedule } = require("../src/fantasyhq/schedule-generator");
const { validateSchedule } = require("../src/fantasyhq/schedule-validator");
const { createFantasyHQRepository } = require("../src/fantasyhq/repository");

function buildFixtureTeams() {
  const east = Array.from({ length: 15 }, (_, index) => ({
    leagueId: "league-test",
    teamId: `east-${index + 1}`,
    teamName: `East Team ${index + 1}`,
    abbreviation: `E${String(index + 1).padStart(2, "0")}`,
    conference: "East",
    assignedUserId: `user-east-${index + 1}`,
  }));

  const west = Array.from({ length: 15 }, (_, index) => ({
    leagueId: "league-test",
    teamId: `west-${index + 1}`,
    teamName: `West Team ${index + 1}`,
    abbreviation: `W${String(index + 1).padStart(2, "0")}`,
    conference: "West",
    assignedUserId: `user-west-${index + 1}`,
  }));

  return [...east, ...west];
}

test("schedule generator passes hard validation across 1000 generations", () => {
  const teams = buildFixtureTeams();
  const signatures = new Set();

  for (let index = 0; index < 1000; index += 1) {
    const schedule = generateSchedule({
      leagueId: "league-test",
      seasonId: "2026",
      teams,
    });
    const validation = validateSchedule(schedule, teams);
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    signatures.add(JSON.stringify(schedule.weeks.map((week) => ({
      week: week.week,
      games: week.games.map((game) => [game.team1Id, game.team2Id].sort().join("-")),
      byes: week.byes.map((bye) => bye.teamId),
    }))));
  }

  assert.ok(signatures.size > 1, "Expected repeated generations to produce different schedules.");
});

test("repository saves and reloads schedules using existing team ids", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fantasyhq-schedule-"));
  const repository = createFantasyHQRepository({ dataRoot: tempRoot });
  const leagueRoot = path.join(tempRoot, "leagues", "league-test");
  fs.mkdirSync(leagueRoot, { recursive: true });

  fs.writeFileSync(path.join(leagueRoot, "league.json"), JSON.stringify({
    leagueId: "league-test",
    name: "League Test",
    currentSeasonId: "2026",
  }, null, 2));
  fs.writeFileSync(path.join(leagueRoot, "teams.json"), JSON.stringify({
    teams: buildFixtureTeams(),
  }, null, 2));

  const context = repository.loadLeague("league-test", "2026");
  const schedule = generateSchedule({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
    teams: context.teams,
  });
  const validation = validateSchedule(schedule, context.teams);
  assert.equal(validation.valid, true, validation.errors.join("\n"));

  const saved = repository.saveSchedule(schedule);
  const loaded = repository.loadSchedule("league-test", "2026");

  assert.equal(saved.leagueId, "league-test");
  assert.equal(loaded.leagueId, "league-test");
  assert.equal(loaded.seasonId, "2026");
  assert.equal(loaded.weeks.length, 15);
  assert.ok(loaded.weeks.every((week) => week.games.every((game) => context.teams.some((team) => team.teamId === game.team1Id))));
});

test('Discord preview pages expose all 15 weeks with matchups, byes and boundary navigation', () => {
  const { previewPayload } = require('../src/fantasyhq/discord-schedule');
  const teams = buildFixtureTeams();
  const schedule = generateSchedule({ leagueId:'league-test',seasonId:'1',teams });
  const context = { league: { name:'Test League' }, teams };
  const pending = { pendingScheduleId:'preview-one', schedule };
  const names = new Map(teams.map(team=>[team.teamId,team.teamName]));
  for (let page=0;page<15;page++) {
    const payload=previewPayload(context,pending,page);
    const embed=payload.embeds[0].toJSON();
    assert.match(embed.title,new RegExp(`Week ${page+1}$`));
    const text=embed.fields.map(field=>field.value).join('\n');
    for(const game of schedule.weeks[page].games) assert.ok(text.includes(`**${names.get(game.team1Id)}** vs ${names.get(game.team2Id)}`));
    for(const bye of schedule.weeks[page].byes) assert.ok(text.includes(`**Bye:** ${names.get(bye.teamId)}`));
    assert.ok(embed.fields.every(field=>field.value.length<=1024));
    const nav=payload.components[0].toJSON().components;
    const ids = payload.components.flatMap(row => row.toJSON().components.map(button => button.custom_id));
    assert.equal(new Set(ids).size, ids.length, `Week ${page + 1} must have unique button IDs`);
    assert.deepEqual(nav.map(button => Number(button.custom_id.split(':')[4])), [0, page - 1, page + 1, 14]);
    assert.equal(nav[0].disabled,page===0);
    assert.equal(nav[3].disabled,page===14);
    assert.equal(nav[1].disabled,page===0);
    assert.equal(nav[2].disabled,page===14);
    for(const row of payload.components)for(const button of row.toJSON().components){assert.ok(button.custom_id.length<=100);assert.ok(button.custom_id === 'setupflow:refresh' || button.custom_id.includes('preview-one'));}
    assert.equal(payload.components[1].components.length,4);
  }
  assert.match(previewPayload(context,pending,999).embeds[0].data.title,/Week 15$/);
  assert.match(previewPayload(context,pending,-1).embeds[0].data.title,/Week 1$/);
  const newer=previewPayload(context,{...pending,pendingScheduleId:'preview-two'});
  assert.ok(newer.components[1].components.every(button=>button.data.custom_id === 'setupflow:refresh' || button.data.custom_id.includes('preview-two')));
});
