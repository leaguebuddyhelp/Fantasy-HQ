const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFantasyHQRepository}=require('../src/fantasyhq/repository');
const {createPreseasonValidator}=require('../src/fantasyhq/preseason-validator');
const {createLeagueService}=require('../src/fantasyhq/league-service');
const {generateSchedule}=require('../src/fantasyhq/schedule-generator');
function fixture(t){
 const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'lb-preseason-rosters-'));t.after(()=>fs.rmSync(dataRoot,{recursive:true,force:true}));
 const repository=createFantasyHQRepository({dataRoot});
 const teams=['East','West'].flatMap(conference=>Array.from({length:15},(_,i)=>({teamId:conference+i,teamName:conference+' '+i,abbreviation:conference+i,conference})));
 repository.saveLeague('league',{currentPhase:'PRESEASON',currentSeasonId:'1'});repository.saveTeams('league',teams);
 repository.saveSettings('league',{});repository.saveSchedule(generateSchedule({leagueId:'league',seasonId:'1',teams}));
 const players=[],members=[];
 for(const [index,team] of teams.entries())for(let i=0;i<(index%2?15:14);i++){
  const playerId=team.teamId+'-'+i;players.push({playerId,name:playerId,overall:75,teamId:team.teamId});members.push({playerId,teamId:team.teamId,seasonId:'1',active:true,position1:'PG'});
 }
 repository.savePlayers('league',players);repository.saveRosterMemberships('league',members);
 const validator=createPreseasonValidator({repository});const args={leagueId:'league',seasonId:'1',validator:validator.validate};
 return {repository,validator,args,members,players,teams};
}
test('regular season starts with mixed 14 and 15 player rosters',t=>{
 const f=fixture(t);assert.equal(f.validator.validate(f.args).ready,true);
 const league=createLeagueService({repository:f.repository}).startRegularSeason(f.args);
 assert.equal(league.currentPhase,'REGULAR_SEASON');assert.equal(league.currentWeek,1);
 assert.deepEqual(f.repository.loadRosterMemberships('league'),f.members);
});
test('13 player and 16 player rosters block season start with the appropriate remedy',t=>{
 for(const count of [13,16]){
  const f=fixture(t),teamId=f.teams[0].teamId;
  const members=f.members.filter(m=>m.teamId!==teamId);
  for(let i=0;i<count;i++)members.push({playerId:teamId+'-'+i,teamId,seasonId:'1',active:true,position1:'PG'});
  f.repository.saveRosterMemberships('league',members);
  const view=f.validator.validate(f.args);assert.equal(view.ready,false);assert.equal(view.checks.rostersValid,false);
  assert.ok(view.errors.some(e=>e.includes(count===13?'14-player minimum':'16/15 players')));
  assert.throws(()=>createLeagueService({repository:f.repository}).startRegularSeason(f.args),/Cannot start season/);
  assert.equal(f.repository.loadLeague('league').league.currentPhase,'PRESEASON');
 }
});
test('allowing 14 players does not allow duplicate roster memberships',t=>{
 const f=fixture(t),members=structuredClone(f.members),other=members.find(m=>m.teamId===f.teams[1].teamId);
 other.playerId=members[0].playerId;f.repository.saveRosterMemberships('league',members);
 const view=f.validator.validate(f.args);assert.equal(view.ready,false);assert.equal(view.checks.rostersValid,false);assert.ok(view.errors.some(e=>e.includes('duplicate roster memberships')));
});
