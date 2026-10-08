const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { myTeamPayload } = require('../src/fantasyhq/discord-preseason');
const { contractView, teamPayroll } = require('../src/shared/player-contract');
const context = { league: { leagueName: 'Test league', currentPhase: 'REGULAR_SEASON', currentWeek: 2 } };

test('every scanned NBA roster fits one compact myteam embed with all players and salary coverage', () => {
  const root = path.join(__dirname, '../data/2kratings/rosters/2026-10-07');
  for (const file of fs.readdirSync(root).filter(name => name.endsWith('.json'))) {
    const source = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    const players = source.players;
    const team = { teamName: source.teamName || file, roster: players.map(player => ({ player: { ...player, contractView: contractView(player, 2026) }, position1: player.position1 })), payroll: teamPayroll(players, 2026), draftPicks: Array.from({ length: 60 }, (_, i) => ({ draftYear: 2027 + i % 6, round: i % 2 + 1 })), schedule: [{ week: 1, opponent: 'Past' }, { week: 2, opponent: 'Next' }] };
    const payload = myTeamPayload(team, context);
    assert.equal(payload.embeds.length, 1);
    const embed = payload.embeds[0];
    assert.ok(embed.length <= 6000, `${file}: ${embed.length}`);
    const data = embed.toJSON();
    assert.ok(data.fields.length <= 25);
    for (const field of data.fields) assert.ok(field.value.length <= 1024);
    const text = JSON.stringify(data);
    for (const player of players.slice(0, 25)) assert.ok(text.includes(player.name), player.name);
    assert.ok(!text.includes('PPG'));
    assert.ok(!text.includes('vs Past'));
    assert.ok(text.includes('vs Next'));
    assert.ok(!text.includes('listed yr'));
    const picks = data.fields.find(field => field.name.includes('Draft picks')).value;
    assert.match(picks, /2027.*10 first-round · 0 second-round/);
    assert.match(picks, /2028.*0 first-round · 10 second-round/);
  }
});

test('myteam handles empty rosters, unknown payroll and oversized imports', () => {
  const team = { teamName: 'Test', roster: [], payroll: teamPayroll([], 2026) };
  let data = myTeamPayload(team, context).embeds[0].toJSON();
  assert.match(JSON.stringify(data), /No roster imported|Salary unavailable/);
  assert.ok(!JSON.stringify(data).includes('$0'));
  team.roster = Array.from({ length: 50 }, () => ({ player: { name: 'Long name '.repeat(10), overall: 80, contractView: contractView({ contract: { seasons: [{ season: '2026-27', salary: 30000000 }, { season: '2027-28', salary: 33000000, option: 'PLAYER' }] } }, 2026) }, position1: 'PG', position2: 'SG' }));
  const embed = myTeamPayload(team, context).embeds[0];
  assert.ok(embed.length <= 6000);
  assert.match(JSON.stringify(embed.toJSON()), /\+25 players/);
});

test('contract wording uses salary and end season while preserving option and unknown information', () => {
  const player = { contract: { seasons: [{ season: '2026-27', salary: 30000000 }, { season: '2027-28', salary: 33000000, option: 'PLAYER' }] } };
  const view = contractView(player, 2026);
  assert.equal(view.short, '$30M this season · through 2027-28 (player option)');
  assert.equal(view.compact, '$30M · through 2027-28 (player option)');
  assert.equal(contractView(player, 2027).compact, '$33M · expires this season · Player option this season');
  assert.equal(contractView({}, 2026).compact, 'Salary unavailable');
});
