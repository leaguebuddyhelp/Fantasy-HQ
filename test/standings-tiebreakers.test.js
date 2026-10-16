const test=require('node:test'),assert=require('node:assert/strict');
const {rankStandings,teamDivision,ensureStandingsDraw,postseasonEligibleTeams}=require('../src/fantasyhq/standings-tiebreakers');
const {fixture}=require('./helpers/free-agency');
// The ranking layer consumes league totals plus the relevant matchup results.
const team=(teamId,extra={})=>({teamId,teamName:teamId,conference:'East',W:5,L:5,GP:10,DIFF:0,...extra});
const game=(a,b,winner=a)=>({team1Id:a,team2Id:b,winnerTeamId:winner});
const ids=(result,filter=['a','b','c'])=>result.conferences.East.filter(t=>filter.includes(t.teamId)).map(t=>t.teamId);

test('NBA divisions resolve from abbreviations and canonical names; custom divisions remain explicit',()=>{
 assert.equal(teamDivision({abbreviation:'BOS'}),'Atlantic');assert.equal(teamDivision({teamName:'Oklahoma City Thunder'}),'Northwest');
 assert.equal(teamDivision({abbreviation:'PHO'}),'Pacific');assert.equal(teamDivision({abbreviation:'BOS',division:'Custom'}),'Custom');assert.equal(teamDivision({teamId:'custom'}),null);
});
test('two-team head-to-head precedes division winner status and differential',()=>{
 const rows=[team('a',{division:'Atlantic'}),team('b',{division:'Central',DIFF:100}),team('leader',{division:'Atlantic',W:8,L:2})];
 assert.deepEqual(ids(rankStandings(rows,[game('a','b')]),['a','b']),['a','b']);
});
test('three-team ties apply division winner status before aggregate head-to-head',()=>{
 const rows=[team('a',{division:'Atlantic'}),team('b',{division:'Central'}),team('c',{division:'Southeast'}),team('x',{division:'Atlantic',W:8}),team('y',{division:'Southeast',W:8})];
 assert.deepEqual(ids(rankStandings(rows,[game('a','b'),game('c','b'),game('a','c')])),['b','a','c']);
});
test('partial multi-team ties restart with two-team head-to-head rather than continuing to differential',()=>{
 const rows=[team('a',{DIFF:100}),team('b',{DIFF:0}),team('c',{DIFF:200})];
 const games=[game('b','a'),game('a','c'),game('a','c'),game('b','c'),game('c','b')];
 assert.deepEqual(ids(rankStandings(rows,games)),['b','a','c']);
});
test('division record applies only when all tied teams share a division',()=>{
 const rows=[team('a',{division:'Atlantic'}),team('b',{division:'Atlantic',DIFF:100}),team('x',{division:'Atlantic',W:8})];
 const games=[game('a','b'),game('b','a'),game('a','x'),game('x','b')];
 assert.deepEqual(ids(rankStandings(rows,games),['a','b']),['a','b']);
});
test('conference record precedes differential for teams in different divisions',()=>{
 const rows=[team('a',{division:'Atlantic'}),team('b',{division:'Central',DIFF:100}),team('x',{division:'Atlantic',W:8}),team('y',{division:'Central',W:8})];
 assert.deepEqual(ids(rankStandings(rows,[game('a','b'),game('b','a'),game('a','x'),game('y','b')]),['a','b']),['a','b']);
});
test('record against own-conference top-ten eligible teams precedes differential',()=>{
 const rows=[team('a',{W:4}),team('b',{W:4,DIFF:100}),...Array.from({length:9},(_,i)=>team('top'+i,{W:8})),team('out',{W:1})];
 const games=[game('a','b'),game('b','a'),game('a','top0'),game('out','a'),game('top0','b'),game('b','out')];
 assert.deepEqual(ids(rankStandings(rows,games),['a','b']),['a','b']);
});
test('two-team ties use opposite-conference postseason records before differential',()=>{
 const rows=[team('a'),team('b',{DIFF:100}),...Array.from({length:10},(_,i)=>team('w'+i,{conference:'West',W:8})),team('out',{conference:'West',W:1})];
 const games=[game('a','b'),game('b','a'),game('a','w0'),game('out','a'),game('w0','b'),game('b','out')];
 assert.deepEqual(ids(rankStandings(rows,games),['a','b']),['a','b']);
});
test('three-team ties do not insert the two-team opposite-conference criterion',()=>{
 const rows=[team('a',{DIFF:1}),team('b',{DIFF:3}),team('c',{DIFF:2}),...Array.from({length:10},(_,i)=>team('w'+i,{conference:'West',W:8})),team('out',{conference:'West',W:1})];
 const games=[game('a','b'),game('b','c'),game('c','a'),game('a','w0'),game('out','a'),game('w0','b'),game('b','out'),game('w0','c'),game('c','out')];
 assert.deepEqual(ids(rankStandings(rows,games)),['b','c','a']);
});
test('complete ties remain provisional until a reproducible random draw is recorded; points scored are not a criterion',t=>{
 const rows=[team('a',{PF:1000}),team('b',{PF:2000})],games=[game('a','b'),game('b','a')];
 const provisional=rankStandings(rows,games);assert.equal(provisional.unresolvedTies.length,1);assert.ok(provisional.conferences.East.every(row=>row.tiebreakPending));
 const f=fixture(t),seed=ensureStandingsDraw(f.repository,'league','1');assert.equal(ensureStandingsDraw(f.repository,'league','1'),seed);
 assert.equal(f.repository.loadAuditLog('league').filter(e=>e.action==='standings.tiebreak.draw.created').length,1);
 const resolved=rankStandings(rows,games,{drawSeed:seed});assert.equal(resolved.unresolvedTies.length,0);assert.deepEqual(rankStandings(rows.slice().reverse(),games,{drawSeed:seed}),resolved);
});


test('postseason opponents include every team tied at the tenth-best conference record',()=>{
 const rows=[...Array.from({length:9},(_,i)=>team('top'+i,{W:8})),team('a',{W:4}),team('b',{W:4}),team('out',{W:1})];
 const eligible=postseasonEligibleTeams(rows).get('East');assert.equal(eligible.size,11);assert.ok(eligible.has('a'));assert.ok(eligible.has('b'));assert.ok(!eligible.has('out'));
});
test('two-team ties apply division winner status after a tied head-to-head record',()=>{
 const rows=[team('a',{division:'Atlantic',DIFF:100}),team('b',{division:'Central'}),team('leader',{division:'Atlantic',W:8})];
 assert.deepEqual(ids(rankStandings(rows,[game('a','b'),game('b','a')]),['a','b']),['b','a']);
});
