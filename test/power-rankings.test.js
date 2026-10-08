const test=require('node:test'),assert=require('node:assert/strict');
const {calculateRankings,createPowerRankingsService}=require('../src/fantasyhq/power-rankings');
const {fixture}=require('./helpers/free-agency');
function input(){const teams=Array.from({length:12},(_,i)=>({teamId:'t'+i,teamName:'Team '+i})),players=teams.flatMap((t,i)=>Array.from({length:15},(_,n)=>({playerId:t.teamId+'p'+n,teamId:t.teamId,overall:95-i,progressionHistory:[{seasonId:'1',change:i===0?5:0}]}))),memberships=players.map(p=>({playerId:p.playerId,teamId:p.teamId}));return {teams,players,memberships,seasonId:'1',key:'W1',now:Date.parse('2026-10-08'),games:[{game:{gameId:'g',team1Id:'t0',team2Id:'t1',weekNumber:1,finalizedAt:'2026-10-08',result:{scores:{t0:110,t1:100}}}}]};}
test('power score uses exact weights, nonrecursive opponent strength, all 15 roster slots and deterministic history movement',()=>{
 const data=input(),result=calculateRankings(data),top=result.teams.find(t=>t.teamId==='t0'),b=top.breakdown;assert.ok(Math.abs(top.score-(.4*b.seasonPerformance+.25*b.rosterStrength+.2*b.recentForm+.15*b.strengthOfSchedule))<.000001);assert.equal(top.wins,1);assert.equal(top.losses,0);assert.equal(result.teams.length,12);assert.deepEqual(calculateRankings(data),result);
 const next=calculateRankings({...data,previous:result.teams});assert.equal(next.teams.filter(t=>t.enteredTop10).length,0);assert.equal(next.teams[0].movement,0);
 const weaker=structuredClone(data);weaker.players.find(p=>p.playerId==='t0p14').overall=40;assert.ok(calculateRankings(weaker).teams.find(t=>t.teamId==='t0').breakdown.rosterStrength<b.rosterStrength);
});
test('preseason ranking includes confirmed roster strength and progression without inventing games',()=>{
 const data=input(),result=calculateRankings({...data,preseason:true,games:[]});assert.equal(result.teams[0].teamId,'t0');assert.equal(result.teams[0].wins,0);assert.ok(result.teams[0].breakdown.progression>50);assert.ok(result.teams.every(t=>Number.isFinite(t.score)));
});
test('forfeit changes record without adding invented point differential and recent form uses last five games',()=>{
 const data=input();data.games=[{game:{gameId:'f',team1Id:'t0',team2Id:'t1',weekNumber:1,finalizedAt:'date',result:{type:'FORFEIT',winnerTeamId:'t0'}}}];const r=calculateRankings(data).teams.find(t=>t.teamId==='t0');assert.equal(r.wins,1);assert.equal(r.breakdown.seasonPerformance,82.5);
 data.games=Array.from({length:6},(_,i)=>({game:{gameId:'g'+i,team1Id:'t0',team2Id:'t1',weekNumber:i+1,finalizedAt:'date',result:{scores:{t0:i===0?200:90,t1:100}}}}));const out=calculateRankings(data).teams.find(t=>t.teamId==='t0');assert.equal(out.breakdown.recentForm,8.75);
});
test('ranking service publishes only finalized weeks, persists snapshots, survives restart and preserves prior seasons',t=>{
 const f=fixture(t),r=f.repository;const schedule={leagueId:'league',seasonId:'1',weeks:Array.from({length:15},(_,i)=>({week:i+1,weekId:'w'+(i+1),games:[],byes:[],status:'PENDING'}))};schedule.weeks.forEach(w=>w.status='PENDING');r.saveSchedule(schedule);const service=createPowerRankingsService({repository:r,submissions:{records:()=>[]},now:()=>Date.parse('2026-10-08')});assert.equal(service.process('league'),null);assert.equal(service.process('league',{preseason:true}),null);
 schedule.weeks[0].status='COMPLETED';r.saveSchedule(schedule);const first=service.process('league');assert.equal(first.key,'W1');assert.equal(service.list('league').length,1);assert.deepEqual(createPowerRankingsService({repository:r}).process('league'),first);
 schedule.weeks[1].status='COMPLETED';r.saveSchedule(schedule);service.process('league');assert.equal(service.list('league').length,2);r.saveLeague('league',{currentSeasonId:'2'});assert.equal(service.list('league',{seasonId:'1'}).length,2);
});
test('Discord maintains one Top 10 pin and notifies only new entrants once across restarts',async t=>{
 const f=fixture(t),r=f.repository,schedule={leagueId:'league',seasonId:'1',weeks:[{week:1,weekId:'w1',games:[],byes:[],status:'COMPLETED'},{week:2,weekId:'w2',games:[],byes:[],status:'PENDING'}]};r.saveSchedule(schedule);r.saveSettings('league',{discordChannels:{powerRankings:'channel'}});const messages=new Map();let sends=0,edits=0,pins=0;
 const channel={id:'channel',messages:{fetch:async arg=>typeof arg==='string'?messages.get(arg):messages},send:async payload=>{sends++;const m={id:'m'+sends,embeds:payload.embeds.map(e=>e.toJSON()),createdTimestamp:Date.now(),pinned:false,pin:async()=>{m.pinned=true;pins++;},edit:async payload=>{edits++;m.embeds=payload.embeds.map(e=>e.toJSON());}};messages.set(m.id,m);return m;}};
 const guild={channels:{fetch:async()=>channel}},make=()=>require('../src/fantasyhq/discord-power-rankings').createDiscordPowerRankings({repository:r,submissions:{records:()=>[]}});
 await make().reconcile(guild,'league');assert.equal(sends,2);assert.equal(pins,1);await Promise.all([make().reconcile(guild,'league'),make().reconcile(guild,'league')]);assert.equal(sends,2);
 schedule.weeks[1].status='COMPLETED';r.saveSchedule(schedule);await make().reconcile(guild,'league');assert.equal(sends,2);assert.equal(edits,1);assert.equal(pins,1);assert.equal(r.loadSettings('league').powerRankingsPin.key,'W2');
});
