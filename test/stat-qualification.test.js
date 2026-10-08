const test = require('node:test');
const assert = require('node:assert/strict');
const { percentageQualification, qualifiesForPercentage } = require('../src/fantasyhq/stat-qualification');
const { statsPayload } = require('../src/fantasyhq/discord-league-feeds');

test('regular shooting minimum follows league week with independent inclusive boundaries', () => {
  const p = { GP: 2, FGA: 30, '3PA': 29, FTA: 31, FGPercent: 100 };
  const q = percentageQualification(p, { currentWeek: 3 });
  assert.equal(q.FGPercent.eligible, true);
  assert.equal(q.threePPercent.eligible, false);
  assert.equal(q.FTPercent.eligible, true);
  assert.equal(qualifiesForPercentage(p, 'FGPercent', { currentWeek: 4 }), false);
  assert.equal(p.FGPercent, 100);
});
test('postseason threshold follows individual non-DNP GP and separates scopes', () => {
  const p = { GP: 3, FGA: 24, '3PA': 23, FTA: 25 };
  for (const scope of ['PLAY_IN', 'PLAYOFFS']) {
    const q = percentageQualification(p, { scope, currentWeek: 15 });
    assert.equal(q.FGPercent.minimumAttempts, 24);
    assert.equal(q.FGPercent.eligible, true);
    assert.equal(q.threePPercent.eligible, false);
  }
  assert.equal(percentageQualification({ GP: 0, FGA: 100 }).FGPercent.eligible, false);
  assert.equal(percentageQualification({ GP: 1, FGA: 0 }).FGPercent.eligible, false);
  assert.throws(() => percentageQualification(p, { scope: 'INVALID' }), /Choose/);
});
test('Discord percentage leaders exclude low-volume shooters while counting categories retain them', () => {
  const players = [
    { playerId: 'low', name: 'Low Volume', GP: 1, PPG: 99, FGPercent: 100, FGA: 1 },
    { playerId: 'qualified', name: 'Qualified', GP: 2, PPG: 20, FGPercent: 50, FGA: 20 },
  ];
  const e = statsPayload(players, { league: { currentWeek: 2, seasonNumber: 1 } }).embeds[0].toJSON();
  assert.match(e.fields.find(f => f.name.includes('Points')).value, /Low Volume/);
  assert.doesNotMatch(e.fields.find(f => f.name.includes('FG%')).value, /Low Volume/);
  assert.match(e.fields.find(f => f.name.includes('FG%')).value, /Qualified/);
});
