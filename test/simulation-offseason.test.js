const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./helpers/free-agency');
const {createSimulationStorage}=require('../src/fantasyhq/simulation-storage');
const {createSimulationEngine}=require('../src/fantasyhq/simulation-engine');
function setup(t){
 const f=fixture(t),teams=Array.from({length:30},(_,i)=>({teamId:'t'+i,teamName:'Team '+i,conference:i<15?'East':'West',abbreviation:'T'+i}));
 const players=teams.flatMap(team=>Array.from({length:15},(_,i)=>({playerId:team.teamId+'p'+i,name:team.teamId+' Player '+i,teamId:team.teamId,age:24,overall:80-i%5,yearsInNBA:i===0?0:3,position1:['PG','SG','SF','PF','C'][i%5]})));
 f.repository.saveTeams('league',teams);f.repository.savePlayers('league',players);f.repository.saveRosterMemberships('league',players.map(p=>({playerId:p.playerId,teamId:p.teamId,seasonId:'1',active:true})));f.repository.saveOwners('league',[]);
 f.repository.saveLeague('league',{commissionerUserId:'c',currentPhase:'OFFSEASON',currentWeek:15,regularSeasonStatus:'COMPLETED',guildId:'guild'});f.repository.saveSchedule(require('../src/fantasyhq/schedule-generator').generateSchedule({leagueId:'league',seasonId:'1',teams}));
 f.repository.commitLeagueFiles({leagueId:'league',files:[{name:'championships.json',value:{version:1,seasons:{'1':{teamId:'t0',finalizedAt:'2026-10-08',confirmedBy:'c'}}}},{name:'awards.json',value:{version:1,seasons:{'1':Object.fromEntries(['REGULAR_SEASON','CONFERENCE_FINALS','NBA_FINALS'].map(group=>[group,{confirmedAt:'2026-10-08',confirmedBy:'c'}]))}}}]});
 const actor={id:'c',authorized:true},storage=createSimulationStorage({repository:f.repository}),sim=storage.create('league',actor);
 return {...f,teams,players,actor,storage,sim};
}
test('existing engine practices every offseason stage, pauses/restores, rolls over once and can run the new season without touching live data',async t=>{
 const f=setup(t),live=fs.readFileSync(f.repository.loadLeague('league').paths.playersFile),events=[];let paused=false;
 const engine=createSimulationEngine({storage:f.storage,onOutput:async(sim,event)=>{events.push(event);if(event.step==='DRAFT'&&!paused){paused=true;engine.pause(f.sim.id,f.actor);}}});
 const first=await engine.run(f.sim.id,f.actor,{offseason:true,outputMode:'FULL'});assert.equal(first.paused,true);assert.equal(first.step,'OPTIONS');
 const afterDraft=f.storage.load(f.sim.id,f.actor);assert.equal(afterDraft.repository.loadPlayers('league').length,525);assert.equal(afterDraft.repository.loadPlayers('league').filter(p=>p.yearsInNBA===0&&p.draftYear===2027).length,75);
 const checkpoint=f.storage.checkpoints(f.sim.id,f.actor).find(cp=>cp.name==='Season 1 DRAFT');assert.ok(checkpoint);
 const finished=await engine.resume(f.sim.id,f.actor);assert.equal(finished.offseasonComplete,true);assert.equal(finished.seasonId,'2');
 let sim=f.storage.load(f.sim.id,f.actor);assert.equal(sim.seasonId,'2');assert.equal(sim.repository.loadLeague('league').league.currentPhase,'PRESEASON');
 const members=sim.repository.loadRosterMemberships('league').filter(m=>m.active!==false&&!m.endedAt);assert.equal(members.length,450);assert.ok(members.every(m=>m.seasonId==='2'));for(const team of f.teams)assert.equal(members.filter(m=>m.teamId===team.teamId).length,15);
 assert.ok(sim.repository.loadOffseason('league').seasons['1'].rolledOver);assert.equal(sim.repository.loadFreeAgencyState('league').offseason['1'].stages.length,4);assert.ok(events.every(e=>e.testMode));
 const rookies=sim.repository.loadPlayers('league').filter(p=>p.draftYear===2027);assert.ok(rookies.every(p=>p.yearsInNBA===0));assert.ok(sim.repository.loadSeasonArchive('league','1'));
 const result=await engine.run(f.sim.id,f.actor,{weeks:1});assert.equal(result.gamesSimulated,14);assert.equal(f.storage.load(f.sim.id,f.actor).repository.loadLeague('league').league.currentWeek,2);
 f.storage.restore(f.sim.id,f.actor,checkpoint.id,true);sim=f.storage.load(f.sim.id,f.actor);assert.equal(sim.seasonId,'1');assert.equal(sim.repository.loadLeague('league').league.currentPhase,'OFFSEASON');assert.equal(sim.repository.loadOffseason('league').seasons['1'].step,'OPTIONS');
 assert.deepEqual(fs.readFileSync(f.repository.loadLeague('league').paths.playersFile),live);assert.equal(f.repository.loadOffseason('league'),null);assert.equal(f.repository.loadLeague('league').seasonId,'1');
});
test('offseason runner refuses live repositories and refuses missing championship evidence',async t=>{
 const f=setup(t);await assert.rejects(require('../src/fantasyhq/simulation-offseason').runSimulationOffseason({sim:{...f.sim,repository:f.repository},actor:f.actor,runtime:{}}),/isolated/);
 const sim=f.storage.load(f.sim.id,f.actor);sim.repository.commitLeagueFiles({leagueId:'league',files:[{name:'championships.json',value:{version:1,seasons:{}}}]});
 await assert.rejects(createSimulationEngine({storage:f.storage}).run(f.sim.id,f.actor,{offseason:true}),/championship/);assert.equal(sim.repository.loadPlayers('league').length,450);
});
