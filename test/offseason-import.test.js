const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const {createFantasyHQRepository}=require('../src/fantasyhq/repository');
const {createOffseasonImportService}=require('../src/fantasyhq/offseason-import-service');
const {STEPS,PHASE_BY_STEP}=require('../src/fantasyhq/offseason-state');
function fixture(t,step){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lb-import-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const repository=createFantasyHQRepository({dataRoot:root});
 const teams=['East','West'].flatMap(conference=>Array.from({length:15},(_,i)=>({teamId:conference+i,teamName:conference+' '+i,abbreviation:conference[0]+i,conference})));
 repository.saveLeague('l',{currentSeasonId:'1',seasonNumber:1,currentPhase:PHASE_BY_STEP[step],commissionerUserId:'c'});repository.saveTeams('l',teams);repository.saveSettings('l',{});repository.saveGuildLeagueBinding('g',{leagueId:'l',seasonId:'1'});
 const players=teams.flatMap(team=>Array.from({length:15},(_,i)=>({playerId:team.teamId+'p'+i,name:team.teamId+' Player '+i,teamId:team.teamId,overall:80,age:25,yearsInNBA:3,position1:'PG',contract:{seasons:[{season:'2026-27',salary:1000000,option:null},{season:'2027-28',salary:1100000,option:null}]}})));
 repository.savePlayers('l',players);repository.saveRosterMemberships('l',players.map(p=>({playerId:p.playerId,teamId:p.teamId,seasonId:'1',active:true})));
 const picks=[1,2].flatMap(round=>teams.map((team,i)=>({pickId:'pick-'+round+'-'+i,round,draftYear:2027,originalTeamId:team.teamId,currentOwnerTeamId:team.teamId,protection:'UNPROTECTED'})));repository.saveDraftPicks('l',picks);
 const order=picks.filter(p=>p.round===1).map((p,i)=>({pickNumber:i+1,originalTeamId:p.originalTeamId,currentOwnerTeamId:p.currentOwnerTeamId,originalPickAssetId:p.pickId}));
 repository.commitLeagueFiles({leagueId:'l',files:[{name:'offseason.json',value:{version:1,seasons:{'1':{seasonId:'1',step,revision:1,completedSteps:STEPS.slice(0,STEPS.indexOf(step)),history:[],receipts:step==='LOTTERY'?{}:{LOTTERY:{confirmedAt:'2026-10-08',requestId:'lottery',order}}}}}}]});
 const prospects=Array.from({length:75},(_,i)=>({board_number:i+1,name:'Prospect '+i,overall:75,age:19,position_1:'SG',position_2:'SF'}));const options={repository,step,recognize:async()=> 'NBA 2K\nEast0 Player 0\nProspect 0',scoutingService:{boardForContext:()=>({file:'class.json',prospects})},backup:()=>({id:'backup'})};const actor={id:'c',authorized:true};const service=createOffseasonImportService(options);
 const evidence=()=>service.upload('l',actor,{filename:'phone.jpg',bytes:null});
 async function upload(){const bytes=await sharp({create:{width:50,height:50,channels:3,background:'white'}}).jpeg().toBuffer();return service.upload('l',actor,{filename:'phone.jpg',bytes});}
 return {root,repository,teams,players,picks,options,actor,service,upload};
}
test('official lottery reconciles 30 unique assets only after reviewed confirmation and records ownership reasons',async t=>{
 const f=fixture(t,'LOTTERY');await f.upload();const rows=f.picks.filter(p=>p.round===1).map((p,i)=>({pickNumber:i+1,originalTeamId:p.originalTeamId,teamId:p.currentOwnerTeamId}));
 assert.throws(()=>f.service.prepare('l',f.actor,{rows,reviewedAllImages:false}),/review every/);rows[0].teamId=f.teams[1].teamId;assert.throws(()=>f.service.prepare('l',f.actor,{rows,reviewedAllImages:true}),/reason/);rows[0].reason='Verified NBA 2K owner';
 const preview=f.service.prepare('l',f.actor,{rows,reviewedAllImages:true});assert.equal(f.repository.loadDraftPicks('l')[0].currentOwnerTeamId,f.teams[0].teamId);
 const receipt=createOffseasonImportService(f.options).confirm('l',f.actor,preview.token);assert.equal(receipt.order.length,30);assert.equal(f.repository.loadDraftPicks('l')[0].currentOwnerTeamId,f.teams[1].teamId);assert.deepEqual(f.service.confirm('l',f.actor,preview.token),receipt);
 const input={teams:f.teams,picks:f.repository.loadDraftPicks('l'),officialOrder:receipt.order};const order=require('../src/fantasyhq/draft-order').generateDraftOrder(input,{lottery:false});assert.equal(order.rules.official,true);assert.equal(order.order[0].currentOwnerTeamId,f.teams[1].teamId);
});
test('draft import promotes 60 drafted and 15 undrafted prospects with permanent IDs, source contracts and 17-player rosters',async t=>{
 const f=fixture(t,'DRAFT');await f.upload();const rows=f.picks.map((p,i)=>({pickNumber:i+1,playerId:'class:'+(i+1),teamId:p.currentOwnerTeamId,pickAssetId:p.pickId,overall:75,age:19,contractYears:i>=30?3:undefined,firstYearSalary:i>=30?1157153:undefined}));
 const input={rows,reviewedAllImages:true,policy:{salaryCap:140588000}};assert.throws(()=>f.service.prepare('l',f.actor,{...input,rows:rows.slice(1)}),/60/);
 const preview=f.service.prepare('l',f.actor,input);assert.equal(f.repository.loadPlayers('l').length,450);const receipt=f.service.confirm('l',f.actor,preview.token);assert.equal(receipt.draftedPlayerIds.length,60);assert.equal(receipt.undraftedPlayerIds.length,15);assert.equal(f.repository.loadPlayers('l').length,525);
 const rookie=f.repository.loadPlayers('l').find(p=>p.playerId==='class:1');assert.equal(rookie.yearsInNBA,0);assert.equal(rookie.age,19);assert.deepEqual(rookie.contract.seasons.map(s=>s.option),[null,null,'TEAM','TEAM']);assert.equal(rookie.scouting.board_number,1);
 const members=f.repository.loadRosterMemberships('l');for(const team of f.teams)assert.equal(members.filter(m=>m.teamId===team.teamId&&m.active!==false).length,17);
 assert.equal(f.repository.loadPlayers('l').find(p=>p.playerId==='class:75').teamId,null);assert.equal(f.repository.loadDraftPicks('l')[0].selectedPlayerId,'class:1');
});
test('pending options preserve age and experience, retain accepted players and release declined players with contract history',async t=>{
 const f=fixture(t,'OPTIONS');const players=f.repository.loadPlayers('l');for(const p of players.slice(0,2))p.contract.seasons[1].option='TEAM';f.repository.savePlayers('l',players);await f.upload();
 const rows=players.slice(0,2).map((p,i)=>({playerId:p.playerId,decision:i?'DECLINED':'ACCEPTED'}));const preview=f.service.prepare('l',f.actor,{rows,reviewedAllImages:true});f.service.confirm('l',f.actor,preview.token);
 const updated=f.repository.loadPlayers('l');assert.equal(updated[0].contract.seasons[1].optionDecision,'ACCEPTED');assert.equal(updated[0].teamId,players[0].teamId);assert.equal(updated[1].teamId,null);assert.equal(updated[1].lastTeamId,players[1].teamId);assert.equal(updated[1].contractHistory.length,1);assert.equal(updated[1].age,25);assert.equal(updated[1].yearsInNBA,3);assert.equal(f.repository.loadRosterMemberships('l').find(m=>m.playerId===updated[1].playerId).endedReason,'OPTION_DECLINED');
});
test('zero pending options can be explicitly reviewed from evidence without inventing decisions',async t=>{const f=fixture(t,'OPTIONS');await f.upload();const p=f.service.prepare('l',f.actor,{rows:[],reviewedAllImages:true});assert.equal(f.service.confirm('l',f.actor,p.token).decisions.length,0);});
test('progression verifies 450 mapped players and all 30 teams, applies uncapped OVR changes atomically and preserves history',async t=>{
 const f=fixture(t,'PROGRESSION');await f.upload();const rows=f.players.map(p=>({playerId:p.playerId,teamId:p.teamId,overall:83,change:3}));rows[0].overall=99;rows[0].change=19;
 const input={rows,reviewedAllImages:true,policy:{preserveExistingSchedule:true}};
 assert.throws(()=>f.service.prepare('l',f.actor,{...input,rows:rows.slice(1)}),/450/);const wrong=structuredClone(rows);wrong[0].change=2;assert.throws(()=>f.service.prepare('l',f.actor,{...input,rows:wrong}),/change/);
 f.service.review('l',f.actor,input);assert.equal(f.service.inspect('l',f.actor).coverage.every(t=>t.reviewed===15),true);const preview=f.service.prepare('l',f.actor,input);assert.equal(f.repository.loadPlayers('l')[0].overall,80);
 const receipt=f.service.confirm('l',f.actor,preview.token);assert.equal(receipt.verifiedTeamIds.length,30);assert.equal(f.repository.loadPlayers('l')[0].overall,99);assert.equal(f.repository.loadPlayers('l')[0].progressionHistory[0].previousOverall,80);const state=f.repository.loadOffseason('l').seasons['1'];assert.ok(state.receipts.PREPARATION);assert.equal(state.schedulePolicy,'CONFERENCE_ROUND_ROBIN_15');
});
test('changed source data, altered originals and unauthorized actors cannot commit an import',async t=>{
 const f=fixture(t,'PROGRESSION');const uploaded=await f.upload();const input={rows:f.players.map(p=>({playerId:p.playerId,teamId:p.teamId,overall:81,change:1})),reviewedAllImages:true};
 assert.throws(()=>f.service.prepare('l',{id:'staff',authorized:true},input),/commissioner/);const p=f.service.prepare('l',f.actor,input);const players=f.repository.loadPlayers('l');players[0].name='Corrected';f.repository.savePlayers('l',players);assert.throws(()=>f.service.confirm('l',f.actor,p.token),/source data changed/);
 const next=f.service.prepare('l',f.actor,input);fs.writeFileSync(path.join(f.root,'leagues','l',uploaded.image.originalPath),'corrupted');assert.throws(()=>f.service.confirm('l',f.actor,next.token),/integrity/);assert.equal(f.repository.loadPlayers('l')[0].overall,80);
});
