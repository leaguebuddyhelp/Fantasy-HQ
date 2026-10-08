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
test('cutdown requires 30 verified 15-player rosters and confirmed coach waivers preserve history',t=>{
 const f=fixture(t);assert.equal(f.service.inspect('l').ready,false);assert.throws(()=>f.service.prepareWaiver('l',f.coach,'extra'),/Open/);f.service.windowAction('l',f.staff,{action:'open'});
 assert.throws(()=>f.service.prepareWaiver('l',{id:'other'},'extra'),/assigned coach/);assert.throws(()=>f.service.prepareWaiver('l',f.staff,'t0p0'),/85/);
 const p=f.service.prepareWaiver('l',f.coach,'extra');assert.equal(f.r.loadPlayers('l').find(p=>p.playerId==='extra').teamId,'t0');assert.throws(()=>f.service.confirmWaiver('l',f.staff,p.token),/expired or changed/);
 const receipt=f.service.confirmWaiver('l',f.coach,p.token);assert.deepEqual(f.service.confirmWaiver('l',f.coach,p.token),receipt);const player=f.r.loadPlayers('l').find(p=>p.playerId==='extra');assert.equal(player.teamId,null);assert.equal(player.contractHistory[0].contract.seasons[0].salary,2000000);assert.equal(f.r.loadRosterMemberships('l').find(m=>m.playerId==='extra').endedReason,'OFFSEASON_CUTDOWN');
 assert.throws(()=>f.service.prepareWaiver('l',f.coach,'t0p1'),/below 15/);assert.equal(f.service.inspect('l').ready,true);const close=f.service.prepareCompletion('l',f.staff);f.service.confirmCompletion('l',f.staff,close.token);assert.equal(f.service.inspect('l').window.status,'COMPLETED');assert.ok(f.service.inspect('l').receipt.confirmedAt);assert.equal(f.service.prepareCompletion('l',f.staff).token,undefined);
});
test('ownership and rating changes invalidate pending cuts; expiry requires review again',t=>{
 const f=fixture(t);f.service.windowAction('l',f.staff,{action:'open'});const p=f.service.prepareWaiver('l',f.coach,'extra');f.r.saveOwners('l',[{teamId:'t0',userId:'other'}]);assert.throws(()=>f.service.confirmWaiver('l',f.coach,p.token),/changed/);
 const next=f.service.prepareWaiver('l',{id:'other'},'extra');const players=f.r.loadPlayers('l');players.find(p=>p.playerId==='extra').overall=85;f.r.savePlayers('l',players);assert.throws(()=>f.service.confirmWaiver('l',{id:'other'},next.token),/changed/);assert.equal(f.r.loadPlayers('l').find(p=>p.playerId==='extra').teamId,'t0');
 players.find(p=>p.playerId==='extra').overall=84;f.r.savePlayers('l',players);const expired=f.service.prepareWaiver('l',{id:'other'},'extra');f.advance();assert.throws(()=>f.service.confirmWaiver('l',{id:'other'},expired.token),/expired/);
});
test('only commissioner opens, extends and completes offseason trade window',t=>{
 const f=fixture(t,'TRADES');assert.throws(()=>f.service.prepareCompletion('l',f.coach),/commissioner/);assert.throws(()=>f.service.windowAction('l',f.staff,{action:'open'}),/not open/);assert.equal(f.service.inspect('l').ready,true);const p=f.service.prepareCompletion('l',f.staff);const receipt=f.service.confirmCompletion('l',f.staff,p.token);assert.deepEqual(f.service.confirmCompletion('l',f.staff,p.token),receipt);
});
