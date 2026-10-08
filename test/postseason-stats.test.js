const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/free-agency');
const {initializePostseason}=require('../src/fantasyhq/postseason-state');
const {createPlayerStatsService}=require('../src/fantasyhq/player-stats-service');
const {createTeamStatsService}=require('../src/fantasyhq/team-stats-service');
test('Play-In, Playoff and regular-season statistics stay separate, excluding unapproved games',t=>{
  const f=fixture(t),teams=['East','West'].flatMap(conference=>Array.from({length:15},(_,i)=>({teamId:conference+i,teamName:conference+i,abbreviation:conference+i,conference}))),seeds=Object.fromEntries(['East','West'].map(c=>[c,teams.filter(t=>t.conference===c).slice(0,10)]));
  f.repository.saveTeams('league',teams);f.repository.saveRosterMemberships('league',[{playerId:'a-0',teamId:'East6',seasonId:'1',active:true}]);
  const state=initializePostseason({leagueId:'league',seasonId:'1',teams,seeds});
  const a=state.series[0];a.gameIds=['in'];
  const b={...structuredClone(a),id:'round1',stage:'FIRST_ROUND',requiredWins:2,gameIds:['out']};state.series.push(b);
  f.repository.commitPostseason({leagueId:'league',playoffs:state,auditEntry:{action:'test'}});
  function record(s,id,pts){return {game:{gameId:id,leagueId:'league',seasonId:'1',seriesId:s.id,stage:s.stage,seriesGameNumber:1,team1Id:s.team1Id,team2Id:s.team2Id,status:'FINAL',finalizedAt:'2026-10-08',approval:{operator:'Staff'},result:{submissionId:'s',extractionId:'e',winnerTeamId:s.team1Id,scores:{[s.team1Id]:100,[s.team2Id]:90}}},submissions:[{submissionId:'s',status:'FINAL'}],extractions:[{submissionId:'s',extractionId:'e',status:'READY_FOR_REVIEW',issues:[]}],playerGameStats:[{gameId:id,teamId:s.team1Id,playerId:'a-0',MIN:30,PTS:pts,REB:5,AST:3,STL:1,BLK:0,TO:2,FGM:5,FGA:10,'3PM':1,'3PA':3,FTM:2,FTA:2,OR:1,FLS:2}],teamGameStats:[]};}
  const records=[record(a,'in',13),record(b,'out',25)],submissions={repository:f.repository,records:()=>records};
  for(const [scope,points]of [['PLAY_IN',13],['PLAYOFFS',25],['REGULAR_SEASON',0]]){const stats=createPlayerStatsService({repository:f.repository,submissions,scope}).getPlayerSeasonStats('league','1','a-0');assert.equal(stats.PTS,points);assert.equal(stats.GP,points?1:0);}
  assert.equal(createTeamStatsService({repository:f.repository,submissions,scope:'PLAY_IN'}).getSeasonSnapshot('league','1').teams.find(t=>t.teamId==='East6').W,1);
  records[1].game.approval=null;assert.equal(createPlayerStatsService({repository:f.repository,submissions,scope:'PLAYOFFS'}).getPlayerSeasonStats('league','1','a-0').GP,0);
  f.repository.saveLeague('league',{currentSeasonId:'2'});assert.equal(f.repository.loadPlayoffs('league','1').seasonId,'1');
});
