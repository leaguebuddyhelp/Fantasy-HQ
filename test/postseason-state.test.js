const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSeeds, initializePostseason, validatePostseason, requireCommissioner } = require('../src/fantasyhq/postseason-state');
const teams = ['East','West'].flatMap(conference => Array.from({ length: 15 }, (_, i) => ({ teamId: conference+i, conference })));
const seeds = Object.fromEntries(['East','West'].map(c => [c,teams.filter(t => t.conference === c).slice(0,10)]));
test('qualification requires ten distinct teams within each conference', () => {
  validateSeeds(seeds, teams);
  assert.throws(() => validateSeeds({ ...seeds, East: seeds.East.slice(0,8) }, teams), /Ten/);
  const bad = structuredClone(seeds); bad.East[9] = bad.East[0];
  assert.throws(() => validateSeeds(bad, teams), /unique/);
  bad.East[9] = seeds.West[0]; assert.throws(() => validateSeeds(bad, teams), /eligible/);
});
test('initialization creates only initial Play-In games and starts 24-hour clock', () => {
  const state = initializePostseason({ leagueId: 'l', seasonId: '1', seeds, teams, now: 0 });
  validatePostseason(state);
  assert.equal(state.series.length, 4);
  assert.deepEqual(state.series[0].wins, { East6: 0, East7: 0 });
  assert.equal(state.rounds[0].deadlineAt, '1970-01-02T00:00:00.000Z');
  assert.deepEqual(seeds.East[0], { teamId: 'East0', conference: 'East' });
});
test('commissioner authorization is bound to persisted identity', () => {
  const context = { league: { commissionerUserId: 'c' } };
  requireCommissioner(context,{id:'c',authorized:true});
  assert.throws(() => requireCommissioner(context,{id:'assistant',authorized:true}), /commissioner/);
});

test('stored postseason validation refuses malformed deadlines and victory data',()=>{
 const state=initializePostseason({leagueId:'l',seasonId:'1',seeds,teams,now:0}),bad=structuredClone(state);bad.rounds[0].deadlineAt='invalid';assert.throws(()=>validatePostseason(bad),/deadline/);
 const wins=structuredClone(state);wins.series[0].wins.East6=2;assert.throws(()=>validatePostseason(wins),/victory/);
 const duplicate=structuredClone(state);duplicate.seeds.East[9]=duplicate.seeds.East[0];assert.throws(()=>validatePostseason(duplicate),/unique/);
});
