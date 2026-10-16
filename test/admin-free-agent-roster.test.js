const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/free-agency');
const {createRosterService}=require('../src/fantasyhq/roster-service');
const {createPlayerService}=require('../src/fantasyhq/player-service');
const {prepareRosterCorrection}=require('../src/fantasyhq/roster-corrections');
const details={salary:'$6M',years:'2+1',structure:'BACK',option:'Team'};
function setup(t){const f=fixture(t);f.repository.saveLeague('league',{currentPhase:'PRESEASON',commissionerUserId:'commish'});return {...f,rosters:createRosterService({repository:f.repository})};}

test('released players return to the pool and rejoin with the same identity and a new contract',t=>{
 const f=setup(t),count=f.repository.loadPlayers('league').length;
 f.rosters.removePlayer({leagueId:'league',seasonId:'1',playerId:'a-0',teamId:'a',actingUserId:'commish'});
 assert.ok(f.rosters.freeAgents('league','1').some(p=>p.playerId==='a-0'));
 assert.equal(f.repository.loadPlayers('league').find(p=>p.playerId==='a-0').contract,undefined);
 const player=f.rosters.assignFreeAgent({leagueId:'league',seasonId:'1',teamId:'b',playerId:'a-0',contractDetails:details,actingUserId:'commish'});
 assert.equal(player.playerId,'a-0');assert.equal(player.teamId,'b');assert.equal(f.repository.loadPlayers('league').length,count);
 assert.deepEqual(player.contract.seasons.map(r=>r.salary),[6000000,6300000,6600000]);assert.equal(player.contract.seasons[2].option,'TEAM');
 assert.equal(player.contractView.totalSalary,18900000);
 const history=f.repository.loadRosterMemberships('league').filter(m=>m.playerId==='a-0');
 assert.equal(history.length,2);assert.equal(history[0].active,false);assert.ok(history[0].endedAt);assert.equal(history[1].active,true);assert.equal(history[1].teamId,'b');
 assert.ok(!f.rosters.freeAgents('league','1').some(p=>p.playerId==='a-0'));
 assert.equal(f.repository.loadAuditLog('league').at(-1).action,'roster.freeagent.assigned');
});

test('pool includes every available player, excludes retired/rostered players, and displays reservations',t=>{
 const f=setup(t),players=f.repository.loadPlayers('league');players.find(p=>p.playerId==='fa-1').retiredAt=new Date().toISOString();f.repository.savePlayers('league',players);
 const state=f.repository.loadFreeAgencyState('league');state.windows.push({id:'reserved',seasonId:'1',playerId:'fa-2',status:'OPEN'});f.repository.saveFreeAgencyState('league',state);
 const pool=f.rosters.freeAgents('league','1');assert.equal(pool.length,9);assert.ok(pool.every(p=>p.playerId.startsWith('fa-')));assert.ok(!pool.some(p=>p.playerId==='fa-1'));assert.match(pool.find(p=>p.playerId==='fa-2').signingBlockedReason,/offer window/);
 for(const [playerId,pattern] of [['a-0',/already on a roster/],['fa-1',/current free agent/],['fa-2',/offer window/]])assert.throws(()=>f.rosters.assignFreeAgent({leagueId:'league',seasonId:'1',teamId:'b',playerId,contractDetails:details}),pattern);
 const before=JSON.stringify(f.repository.loadPlayers('league'));
 assert.throws(()=>f.rosters.assignFreeAgent({leagueId:'league',seasonId:'1',teamId:'b',playerId:'fa-3',contractDetails:{...details,salary:'invalid'}}),/salary/);
 assert.equal(JSON.stringify(f.repository.loadPlayers('league')),before);
});

test('live assignment requires a commissioner correction bound to player and contract',t=>{
 const f=setup(t);f.repository.saveLeague('league',{currentPhase:'REGULAR_SEASON'});
 const args={leagueId:'league',seasonId:'1',teamId:'a',playerId:'fa-3',contractDetails:details,actingUserId:'commish'};
 assert.throws(()=>f.rosters.assignFreeAgent(args),/Preview and confirm/);
 const preview=prepareRosterCorrection(f.repository,'assign',args,'Correct signed player assignment');
 assert.throws(()=>f.rosters.assignFreeAgent({...args,contractDetails:{...details,salary:'$8M'},correctionToken:preview.token}),/Preview and confirm/);
 f.rosters.assignFreeAgent({...args,correctionToken:preview.token});
 assert.equal(f.repository.loadAuditLog('league').at(-1).correction.confirmedBy,'commish');
 assert.throws(()=>f.rosters.assignFreeAgent({...args,correctionToken:preview.token}),/Preview and confirm/);
});

test('releasing through the player editor also clears the old contract and returns the player to the pool',t=>{
 const f=setup(t),service=createPlayerService({repository:f.repository});
 service.updatePlayer({leagueId:'league',seasonId:'1',playerId:'a-0',patch:{teamId:null},actingUserId:'commish'});
 const player=f.rosters.freeAgents('league','1').find(p=>p.playerId==='a-0');assert.ok(player);assert.equal(player.contract,undefined);
});
