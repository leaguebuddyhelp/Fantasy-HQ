const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./helpers/free-agency');
const {createSimulationStorage}=require('../src/fantasyhq/simulation-storage');
const {createSimulationEngine}=require('../src/fantasyhq/simulation-engine');
const {simulateBoxScore}=require('../src/fantasyhq/simulation-box-score');
const {seededRandom}=require('../src/fantasyhq/mock-engine');
function roster(overall){return Array.from({length:15},(_,i)=>({playerId:'p'+i,name:'Player '+i,overall,age:22,position1:['PG','SG','SF','PF','C'][i%5]}));}
test('box scores reconcile and ratings improve odds while still allowing upsets',()=>{let strong=0;for(let i=0;i<150;i++){const [a,b]=simulateBoxScore(roster(90),roster(75),seededRandom(i));strong+=a.totals.PTS>b.totals.PTS;assert.equal(a.totals.PTS,a.players.reduce((n,p)=>n+p.PTS,0));assert.equal(a.totals.MIN,240);}assert.ok(strong>100&&strong<150,`${strong}/150`);});
function setup(t){const f=fixture(t);const teams=['East','West'].flatMap(conference=>Array.from({length:15},(_,i)=>({teamId:conference+i,conference,teamName:conference+i,abbreviation:conference+i}))),players=[],members=[];for(const team of teams)for(let i=0;i<15;i++){const p={...roster(80)[i],playerId:team.teamId+'-'+i,name:team.teamId+' Player '+i,teamId:team.teamId,age:i<7?22:30,yearsInNBA:i===0?0:5,overall:85-Math.floor(i/2),archetype:i%2?'Playmaker':'Shooter'};players.push(p);members.push({playerId:p.playerId,teamId:team.teamId,seasonId:'1',active:true,position1:p.position1});}f.repository.savePlayers('league',players);f.repository.saveRosterMemberships('league',members);f.repository.saveTeams('league',teams);f.repository.saveOwners('league',[]);f.repository.saveLeague('league',{commissionerUserId:'c',guildId:'guild',currentPhase:'PRESEASON',currentWeek:null});f.repository.saveSchedule(require('../src/fantasyhq/schedule-generator').generateSchedule({leagueId:'league',seasonId:'1',teams}));const actor={id:'c',authorized:true},storage=createSimulationStorage({repository:f.repository}),sim=storage.create('league',actor),engine=createSimulationEngine({storage,rng:seededRandom('season')});return {...f,actor,storage,sim,engine};}
test('1/3/5-week batches and full season/postseason are isolated and checkpointed',async t=>{const f=setup(t),before=fs.readFileSync(f.repository.loadLeague('league').paths.playersFile,'utf8');let result=await f.engine.run(f.sim.id,f.actor,{weeks:1});assert.equal(result.weeksCompleted,1);result=await f.engine.run(f.sim.id,f.actor,{weeks:3});assert.equal(result.weeksCompleted,3);result=await f.engine.run(f.sim.id,f.actor,{weeks:5});assert.equal(result.weeksCompleted,5);result=await f.engine.run(f.sim.id,f.actor,{weeks:15});assert.equal(result.weeksCompleted,6);assert.equal(result.games,210);let sim=f.storage.load(f.sim.id,f.actor);const standings=require('../src/fantasyhq/standings-service').createStandingsService({repository:sim.repository}).getStandings('league','1');assert.equal(standings.countedGames,210);assert.equal(Object.values(standings.conferences).flat().reduce((n,t)=>n+t.W,0),210);assert.equal(f.storage.runtime(f.sim.id,f.actor).transactions.length,0);assert.ok(Object.values(f.storage.runtime(f.sim.id,f.actor).development).every(p=>p.gain<=2));for(const name of ['Week 5','Week 10','Week 15'])assert.ok(f.storage.checkpoints(f.sim.id,f.actor).some(cp=>cp.name===name));result=await f.engine.run(f.sim.id,f.actor,{playoffs:true});assert.equal(result.phase,'OFFSEASON');assert.ok(result.champion.teamId);assert.equal(f.storage.checkpoints(f.sim.id,f.actor).length,9);assert.equal(fs.readFileSync(f.repository.loadLeague('league').paths.playersFile,'utf8'),before);assert.equal(f.repository.loadLeague('league').league.currentPhase,'PRESEASON');});
test('simulation-only transaction bypass is blocked on live repositories',t=>{const f=fixture(t);assert.throws(()=>require('../src/fantasyhq/trade-service').createTradeService({repository:f.repository}).completeSimulatedTrade({leagueId:'league',transfers:[],participatingTeams:['a','b'],actorUserId:'staff'}),/isolated/);assert.throws(()=>f.service.simulateReplacement('league',{teamId:'a',playerId:'fa-0',releasePlayerId:'a-0'}),/isolated/);});

test('Full output is test-labeled and tracked; Quiet output suppresses messages; automatic moves remain isolated',async t=>{
 const f=setup(t),events=[],engine=createSimulationEngine({storage:f.storage,rng:seededRandom('output'),onOutput:async(sim,event)=>{events.push(event);return {messageId:'test-'+events.length,channelId:'staff',guildId:'guild'};}});
 await engine.run(f.sim.id,f.actor,{weeks:1,outputMode:'FULL',automaticTransactions:false});assert.equal(events.filter(e=>e.type==='GAME').length,14);assert.ok(events.every(e=>e.testMode));assert.equal(f.storage.runtime(f.sim.id,f.actor).discordContent.length,15);
 const count=events.length;await engine.run(f.sim.id,f.actor,{weeks:3,outputMode:'QUIET',automaticTransactions:true});assert.equal(events.length,count);
 const runtime=f.storage.runtime(f.sim.id,f.actor);assert.ok(runtime.transactions.length>0);assert.equal(f.repository.loadTrades('league').length,0);
 const sim=f.storage.load(f.sim.id,f.actor);for(const team of sim.repository.loadLeague('league').teams)assert.equal(sim.repository.loadRosterMemberships('league').filter(m=>m.teamId===team.teamId&&m.active!==false&&!m.endedAt).length,15);
 const start=f.storage.checkpoints(f.sim.id,f.actor).find(cp=>cp.name==='Starting state');f.storage.restore(f.sim.id,f.actor,start.id,true);assert.equal(f.storage.runtime(f.sim.id,f.actor).transactions.length,0);
});

test('pause/resume finishes the original requested weeks and prevents concurrent simulations',async t=>{
 const f=setup(t);let requested=false,conflictChecked=false;const second=f.storage.create('league',f.actor);
 const engine=createSimulationEngine({storage:f.storage,rng:seededRandom('pause'),onOutput:async()=>{
  if(!requested){requested=true;engine.pause(f.sim.id,f.actor);assert.throws(()=>engine.run(second.id,f.actor,{weeks:1}),/already running/);conflictChecked=true;}
 }});
 const first=await engine.run(f.sim.id,f.actor,{weeks:3,outputMode:'FULL'});assert.equal(first.paused,true);assert.equal(first.weeksCompleted,1);assert.equal(f.storage.runtime(f.sim.id,f.actor).status,'PAUSED');assert.ok(conflictChecked);
 assert.throws(()=>engine.run(f.sim.id,f.actor,{weeks:1}),/Resume/);assert.throws(()=>engine.resume(f.sim.id,{id:'other',authorized:true}),/commissioner/);
 const resumed=await engine.resume(f.sim.id,f.actor);assert.equal(resumed.weeksCompleted,2);assert.equal(f.storage.runtime(f.sim.id,f.actor).status,'IDLE');assert.equal(f.storage.load(f.sim.id,f.actor).repository.loadLeague('league').league.currentWeek,4);
 assert.equal(f.storage.runtime(f.sim.id,f.actor).history.filter(e=>e.type==='GAME').length,42);assert.equal(f.repository.loadLeague('league').league.currentPhase,'PRESEASON');
});

test('simulated box-score corrections change underlying wins and published stats; checkpoint restores exact results',async t=>{
 const f=setup(t);await f.engine.run(f.sim.id,f.actor,{weeks:1});const sim=f.storage.load(f.sim.id,f.actor),submissions=require('../src/fantasyhq/game-submissions').createGameSubmissionService({repository:sim.repository});
 const record=submissions.records().sort((a,b)=>Math.abs(Object.values(a.game.result.scores)[0]-Object.values(a.game.result.scores)[1])-Math.abs(Object.values(b.game.result.scores)[0]-Object.values(b.game.result.scores)[1]))[0],loser=[record.game.team1Id,record.game.team2Id].find(id=>id!==record.game.result.winnerTeamId),row=record.playerGameStats.find(p=>p.teamId===loser),margin=Math.abs(Object.values(record.game.result.scores)[0]-Object.values(record.game.result.scores)[1]);
 const stats=Object.fromEntries(require('../src/fantasyhq/simulation-box-score').FIELDS.map(k=>[k,row[k]]));stats.FTA+=margin+1;stats.FTM+=margin+1;stats.PTS+=margin+1;
 const correct=require('../src/fantasyhq/simulation-corrections').correctSimulatedPlayer,args={storage:f.storage,id:f.sim.id,actor:f.actor,gameId:record.game.gameId,playerId:row.playerId,reason:'Correct simulated free throws'};
 await assert.rejects(correct({...args,stats:{...stats,PTS:1}}),/reconcile/);assert.equal(f.storage.checkpoints(f.sim.id,f.actor).length,1);
 await correct({...args,stats});const changed=submissions.load(record.game.gameId);assert.equal(changed.game.result.winnerTeamId,loser);assert.equal(changed.resultRevisions.length,1);
 const playerStats=require('../src/fantasyhq/player-stats-service').createPlayerStatsService({repository:sim.repository,submissions}).getPlayerSeasonStats('league','1',row.playerId);assert.equal(playerStats.PTS,stats.PTS);
 const before=f.storage.checkpoints(f.sim.id,f.actor).find(cp=>cp.name.startsWith('Before correction'));const restored=f.storage.restore(f.sim.id,f.actor,before.id,true),records=require('../src/fantasyhq/game-submissions').createGameSubmissionService({repository:restored.repository});assert.deepEqual(records.load(record.game.gameId).game.result,record.game.result);assert.equal(f.storage.runtime(f.sim.id,f.actor).status,'IDLE');assert.equal(f.repository.loadLeague('league').league.currentPhase,'PRESEASON');
});

test('simulation supports real rosters of different sizes without adding players',()=>{
 for(const count of [5,8,10,13,14,15,17]){
  const players=Array.from({length:count},(_,i)=>({...roster(80)[i%15],playerId:'actual-'+i}));
  const [side]=simulateBoxScore(players,players,seededRandom(count));
  assert.equal(side.totals.MIN,240);assert.ok(side.players.every(p=>p.MIN<=48));
  assert.equal(side.players.length+side.dnp.length,count);assert.ok(side.players.every(p=>players.some(real=>real.playerId===p.playerId)));
 }
 assert.throws(()=>simulateBoxScore(roster(80).slice(0,4),roster(80)),/at least 5/);
 assert.throws(()=>simulateBoxScore([...roster(80),roster(80)[0]],roster(80)),/different stored/);
});

test('mixed roster sizes run a week; invalid rosters fail before changing simulated results',async t=>{
 const f=setup(t),sim=f.storage.load(f.sim.id,f.actor);
 let members=sim.repository.loadRosterMemberships('league');
 members=members.filter(m=>!m.playerId.startsWith('East0-')||Number(m.playerId.split('-')[1])<13);sim.repository.saveRosterMemberships('league',members);
 const result=await f.engine.run(f.sim.id,f.actor,{weeks:1});assert.equal(result.gamesSimulated,14);
 const phase=sim.repository.loadLeague('league').league;
 members=members.filter(m=>!m.playerId.startsWith('West0-')||Number(m.playerId.split('-')[1])<4);sim.repository.saveRosterMemberships('league',members);
 assert.throws(()=>f.engine.run(f.sim.id,f.actor,{weeks:1}),/West0: Simulation needs/);
 assert.deepEqual(sim.repository.loadLeague('league').league,phase);assert.equal(f.storage.runtime(f.sim.id,f.actor).status,'IDLE');
});
