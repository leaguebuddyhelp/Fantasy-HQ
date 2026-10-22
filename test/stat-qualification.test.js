const test = require('node:test');
const assert = require('node:assert/strict');
const { percentageQualification, qualifiesForPercentage } = require('../src/fantasyhq/stat-qualification');
const { statsPayload } = require('../src/fantasyhq/discord-league-feeds');

test('regular shooting minimum follows league week with independent inclusive boundaries', () => {
  const p = { GP: 2, FGA: 30, '3PA': 9, FTA: 31, FGPercent: 100 };
  const q = percentageQualification(p, { currentWeek: 3 });
  assert.equal(q.FGPercent.eligible, true);
  assert.equal(q.threePPercent.eligible, false);
  assert.equal(q.FTPercent.eligible, true);
  assert.equal(qualifiesForPercentage(p, 'FGPercent', { currentWeek: 4 }), false);
  assert.equal(p.FGPercent, 100);
});
test('postseason threshold follows individual non-DNP GP and separates scopes', () => {
  const p = { GP: 3, FGA: 24, '3PA': 14, FTA: 25 };
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

test('regular-season minimum starts at ten attempts before Week 1 and matches the pin', () => {
  for (const currentWeek of [undefined, null, 0, 1]) {
    const q = percentageQualification({ GP: 1, FGA: 9, '3PA': 10, FTA: 11 }, { currentWeek });
    assert.equal(q.FGPercent.minimumAttempts, 10);
    assert.equal(q.FGPercent.eligible, false);
    assert.equal(q.threePPercent.eligible, true);
    assert.equal(q.FTPercent.eligible, true);
    const embed = statsPayload([], { league: { currentWeek, seasonNumber: 1 } }).embeds[0].toJSON();
    assert.match(embed.description, /FG%: minimum 10 total attempts/);
  }
});


test('three-point and free-throw leaders require five attempts per game with inclusive boundaries', () => {
  for (const scope of ['REGULAR_SEASON','PLAY_IN','PLAYOFFS']) for (const GP of [1,2,3]) {
    const options={scope,currentWeek:12};
    const below=percentageQualification({GP,'3PA':GP*5-1,FTA:GP*5-1},options);
    assert.equal(below.threePPercent.minimumAttempts,GP*5);
    assert.equal(below.FTPercent.minimumAttempts,GP*5);
    assert.equal(below.threePPercent.eligible,false);
    assert.equal(below.FTPercent.eligible,false);
    const exact=percentageQualification({GP,'3PA':GP*5,FTA:GP*5},options);
    assert.equal(exact.threePPercent.eligible,true);
    assert.equal(exact.FTPercent.eligible,true);
    assert.equal(percentageQualification({GP:0,'3PA':100,FTA:100},options).FTPercent.eligible,false);
  }
  const players=[{name:'Five Attempts',playerId:'p',GP:1,'3PA':5,FTA:5,threePPercent:80,FTPercent:100}];
  const embed=statsPayload(players,{league:{currentWeek:2}}).embeds[0].toJSON();
  assert.match(embed.description,/3PT% and FT%: minimum 5 attempts per game played/);
  for(const name of ['3PT%','FT%']) assert.match(embed.fields.find(f=>f.name.includes(name)).value,/Five Attempts/);
});
