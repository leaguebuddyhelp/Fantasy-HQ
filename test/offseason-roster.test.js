const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFantasyHQRepository}=require('../src/fantasyhq/repository');
const {createOffseasonRosterService}=require('../src/fantasyhq/offseason-roster-service');
const {STEPS}=require('../src/fantasyhq/offseason-state');
function fixture(t,step='CUTDOWN'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lb-cutdown-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));const r=createFantasyHQRepository({dataRoot:root});
 const teams=Array.from({length:30},(_,i)=>({teamId:'t'+i,teamName:'Team '+i,abbreviation:'T'+i,conference:i<15?'East':'West'}));r.saveLeague('l',{currentSeasonId:'1',seasonNumber:1,currentPhase:'OFFSEASON',commissionerUserId:'c'});r.saveTeams('l',teams);r.saveSettings('l',{});r.saveOwners('l',[{teamId:'t0',userId:'coach'}]);
 const players=teams.flatMap(team=>Array.from({length:15},(_,i)=>({playerId:team.teamId+'p'+i,name:team.teamName+' '+i,teamId:team.teamId,overall:i===0?85:80,contract:{seasons:[{season:'2027-28',salary:1000000}]}})));players.push({playerId:'extra',name:'Extra',teamId:'t0',overall:84,contract:{seasons:[{season:'2027-28',salary:2000000}]}});r.savePlayers('l',players);r.saveRosterMemberships('l',players.map(p=>({playerId:p.playerId,teamId:p.teamId,seasonId:'1',active:true})));
 r.commitLeagueFiles({leagueId:'l',files:[{name:'offseason.json',value:{version:1,seasons:{'1':{seasonId:'1',step,revision:1,completedSteps:STEPS.slice(0,STEPS.indexOf(step)),history:[],receipts:{}}}}}]});
 let clock=Date.parse('2026-10-08T12:00:00Z');const service=createOffseasonRosterService({repository:r,now:()=>clock,backup:()=>{}}),staff={id:'c',authorized:true},coach={id:'coach'};return {r,service,staff,coach,advance:()=>clock+=300001};
}
test('cutdowns review recorded rosters without creating waivers, and allow 14 or 15 players',t=>{
 const f=fixture(t);assert.equal(f.service.inspect('l').ready,false);
 const members=f.r.loadRosterMemberships('l');members.find(m=>m.playerId==='extra').active=false;members.find(m=>m.playerId==='t1p14').active=false;f.r.saveRosterMemberships('l',members);
 assert.equal(f.service.inspect('l').ready,true);assert.equal(f.service.prepareWaiver,undefined);
 const p=f.service.prepareCompletion('l',f.staff);const receipt=f.service.confirmCompletion('l',f.staff,p.token);assert.ok(receipt.confirmedAt);assert.deepEqual(f.service.confirmCompletion('l',f.staff,p.token),receipt);
});
test('free agency completion reviews rosters without offer stages or mandatory salaries',t=>{
 const f=fixture(t,'FREE_AGENCY');f.r.saveLeague('l',{currentPhase:'FREE_AGENCY'});assert.equal(f.service.inspect('l').ready,true);
 f.r.saveFreeAgencyState('l',{windows:[{status:'OPEN',seasonId:'1'}],offers:[{status:'APPROVED',seasonId:'1'}],waivers:[]});
 const p=f.service.prepareCompletion('l',f.staff);f.service.confirmCompletion('l',f.staff,p.token);assert.ok(f.r.loadOffseason('l').seasons['1'].receipts.FREE_AGENCY.confirmedAt);
});
test('roster review requires commissioner, expires and rejects changed source data',t=>{
 const f=fixture(t,'TRADES');assert.throws(()=>f.service.prepareCompletion('l',f.coach),/commissioner/);const p=f.service.prepareCompletion('l',f.staff);f.advance();assert.throws(()=>f.service.confirmCompletion('l',f.staff,p.token),/expired/);
 const next=f.service.prepareCompletion('l',f.staff),players=f.r.loadPlayers('l');players[0].overall=90;f.r.savePlayers('l',players);assert.throws(()=>f.service.confirmCompletion('l',f.staff,next.token),/changed/);
});
