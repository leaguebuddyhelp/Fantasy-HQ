const {requireSimulationRepository}=require('./simulation-guard');
const {activeMemberships}=require('./service-helpers');
const {leagueSeasonStartYear}=require('./asset-valuation');
const {seededRandom}=require('./mock-engine');

// This is a stage runner for the existing engine. Every mutation uses the production
// review/confirmation services, with conspicuously labeled synthetic test evidence.
async function runSimulationOffseason({sim,actor,runtime,onStage=async()=>false,scoutingService}) {
 const repository=sim.repository,leagueId=sim.leagueId;
 requireSimulationRepository(repository,leagueId,sim.id);
 let clock=runtime.offseasonClock||Date.now();const now=()=>clock;
 const backup=()=>({id:'TEST_MODE_CHECKPOINT_REQUIRED'}),staff={...actor,staffAuthorized:true};
 const lifecycle=require('./offseason-service').createOffseasonService({repository,now,backup});
 const initial=repository.loadLeague(leagueId);
 scoutingService ||= require('./scouting-service').createScoutingService({repository});
 if(!['OFFSEASON','DRAFT','FREE_AGENCY'].includes(initial.league.currentPhase))throw Error('Finish the simulated championship before running the offseason.');
 const year=leagueSeasonStartYear(initial.league.seasonNumber)+1,nextSeason=`${year}-${String(year+1).slice(-2)}`;
 const recognize=async()=> 'TEST MODE · Synthetic practice evidence; never an official NBA 2K report.';
 async function evidence(service,step) {
  if(service.inspect(leagueId,staff).images?.length)return;
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="160"><rect width="800" height="160" fill="white"/><text x="20" y="55" font-size="24">TEST MODE · ${step}</text><text x="20" y="100" font-size="18">Synthetic practice evidence — not official NBA 2K results</text></svg>`);
  await service.upload(leagueId,staff,{filename:`TEST-MODE-${step}.png`,bytes:await require('sharp')(svg).png().toBuffer()});
 }
 const owners=repository.loadOwners(leagueId);
 for(const team of initial.teams)if(!owners.some(o=>o.teamId===team.teamId))owners.push({teamId:team.teamId,userId:`simulation:${sim.id}:${team.teamId}`,assignedAt:new Date(0).toISOString()});
 repository.saveOwners(leagueId,owners);
 // Missing contracts in imported rating fixtures receive explicit simulation-only
 // assumptions; actual stored contract terms are never replaced.
 if(!runtime.offseasonFixtures?.[initial.seasonId]) {
  const players=repository.loadPlayers(leagueId),members=activeMemberships(repository.loadRosterMemberships(leagueId),initial.seasonId),changed=[];
  for(const player of players.filter(p=>members.some(m=>m.playerId===p.playerId)&&!p.contract?.seasons?.length)) {
   player.contract=require('./contract-details').normalizeContractDetails({salary:1000000,years:'3',structure:'Flat',option:'None'},{year:year-1}).contract;
   player.contract.source='TEST_MODE_ASSUMPTION';changed.push(player.playerId);
  }
  if(changed.length)repository.savePlayers(leagueId,players);
  runtime.offseasonFixtures ||= {};runtime.offseasonFixtures[initial.seasonId]={missingContractPlayerIds:changed,salaryCap:140588000,source:'TEST_MODE_ASSUMPTION'};
 }
 for(;;) {
  requireSimulationRepository(repository,leagueId,sim.id);
  const view=lifecycle.inspect(leagueId),step=view.step,state=repository.loadOffseason(leagueId)?.seasons[initial.seasonId];
  if(step==='WRAP_UP') {
   const preview=lifecycle.prepare(leagueId,staff);if(!preview.token)throw Error(preview.blockers.join(' '));lifecycle.confirm(leagueId,staff,preview.token);
  } else {
   if(!state.receipts?.[step]) {
    if(step==='RETIREMENTS') {
     const service=require('./retirement-import-service').createRetirementImportService({repository,now,recognize,backup});
     await evidence(service,step);const preview=service.prepare(leagueId,staff,{playerIds:[],noRetirements:true,reviewedAllImages:true});service.confirm(leagueId,staff,preview.token);
    } else if(['LOTTERY','DRAFT','OPTIONS','PROGRESSION'].includes(step)) {
     const service=require('./offseason-import-service').createOffseasonImportService({repository,step,now,recognize,backup,scoutingService});
     await evidence(service,step);const input={reviewedAllImages:true,policy:{salaryCap:140588000,scalePercentage:120,preserveExistingSchedule:true}};
     const players=repository.loadPlayers(leagueId),members=activeMemberships(repository.loadRosterMemberships(leagueId),initial.seasonId);
     if(step==='LOTTERY') {
      require('./trade-service').createTradeService({repository}).initializeDraftPicks({leagueId,seasonId:initial.seasonId,actingUserId:'TEST MODE'});
      const c=repository.loadLeague(leagueId),order=require('./draft-order').generateDraftOrder({teams:c.teams,picks:repository.loadDraftPicks(leagueId),draftYear:year,standings:require('./standings-service').createStandingsService({repository}).getStandings(leagueId,initial.seasonId),settings:repository.loadSettings(leagueId)},{rng:seededRandom(sim.id+':'+initial.seasonId+':lottery')}).order;
      input.rows=order.map(p=>({pickNumber:p.pickNumber,originalTeamId:p.originalTeamId,teamId:p.currentOwnerTeamId,reason:'TEST MODE simulated lottery'}));
     } else if(step==='DRAFT') {
      const board=service.inspect(leagueId,staff),order=state.receipts.LOTTERY.order,picks=repository.loadDraftPicks(leagueId).filter(p=>p.draftYear===year&&p.round===2).sort((a,b)=>a.originalTeamId.localeCompare(b.originalTeamId));
      const scale=require('./rookie-contracts').rookieScale({draftYear:year,salaryCap:input.policy.salaryCap});
      const raw=scoutingService.boardForContext(repository.loadLeague(leagueId)),prospects=raw.prospects.map(p=>({...p,prospectId:raw.file.replace(/\.json$/i,'')+':'+p.board_number}));
      const slots=[...order,...picks.map((p,i)=>({pickNumber:i+31,currentOwnerTeamId:p.currentOwnerTeamId,originalPickAssetId:p.pickId}))];
      const mockInput={teams:initial.teams,draftYear:year,prospects,rosters:Object.fromEntries(initial.teams.map(t=>[t.teamId,members.filter(m=>m.teamId===t.teamId).map(m=>players.find(p=>p.playerId===m.playerId))]))};
      const selections=require('./mock-engine').project(mockInput,slots,null,seededRandom(sim.id+':'+initial.seasonId+':mock'));
      runtime.history.push({type:'TEST_MODE_MOCK_DRAFT',seasonId:initial.seasonId,selections});
      input.rows=selections.map((slot,index)=>{const p=board.players.find(p=>p.playerId===slot.prospectId);return {pickNumber:index+1,playerId:p.playerId,teamId:slot.currentOwnerTeamId,pickAssetId:slot.originalPickAssetId,overall:p.overall,age:p.age,contractYears:index>=30?3:undefined,firstYearSalary:index>=30?scale.secondRound.minimumFirstYear:undefined};});
     } else if(step==='OPTIONS') {
      input.rows=players.filter(p=>!p.retiredAt&&p.contract?.seasons?.some(s=>s.season===nextSeason&&s.option&&!s.optionDecision)).map(p=>({playerId:p.playerId,decision:'ACCEPTED'}));
     } else {
      const rng=seededRandom(sim.id+':'+initial.seasonId+':progression');input.rows=members.map(m=>{const p=players.find(p=>p.playerId===m.playerId),change=p.age<25?(rng()<.5?1:0):p.age>32?(rng()<.5?-1:0):0,overall=Math.max(1,Math.min(99,p.overall+change));return {playerId:p.playerId,teamId:m.teamId,overall,change:overall-p.overall};});
     }
     const preview=service.prepare(leagueId,staff,input);service.confirm(leagueId,staff,preview.token);
    } else if(['TRADES','CUTDOWN','FREE_AGENCY'].includes(step)) {
     if(step==='FREE_AGENCY'||step==='CUTDOWN') {
      const players=repository.loadPlayers(leagueId),members=repository.loadRosterMemberships(leagueId),at=new Date(now()).toISOString();
      for(const team of initial.teams) {
       let roster=activeMemberships(members,initial.seasonId).filter(m=>m.teamId===team.teamId);
       while(roster.length>15) {
        const cut=roster.slice().sort((a,b)=>players.find(p=>p.playerId===a.playerId).overall-players.find(p=>p.playerId===b.playerId).overall)[0];
        cut.active=false;cut.endedAt=at;cut.endedReason='TEST_MODE_RECONCILIATION';const p=players.find(p=>p.playerId===cut.playerId);p.lastTeamId=team.teamId;p.teamId=null;roster=roster.filter(m=>m!==cut);
       }
       while(roster.length<15) {
        const p=players.filter(p=>!p.retiredAt&&!activeMemberships(members,initial.seasonId).some(m=>m.playerId===p.playerId)).sort((a,b)=>b.overall-a.overall)[0];
        if(!p)throw Error('Test Mode needs enough available players to reconcile rosters.');
        p.teamId=team.teamId;const m={playerId:p.playerId,teamId:team.teamId,seasonId:initial.seasonId,active:true,startedAt:at,source:'TEST_MODE_RECONCILIATION'};members.push(m);roster.push(m);
       }
      }
      repository.savePlayers(leagueId,players);repository.saveRosterMemberships(leagueId,members);
      runtime.history.push({type:'TEST_MODE_ROSTER_RECONCILIATION',seasonId:initial.seasonId,step});
     }
     const service=require('./offseason-roster-service').createOffseasonRosterService({repository,now,backup});
     const preview=service.prepareCompletion(leagueId,staff);if(!preview.token)throw Error(preview.blockers.join(' '));service.confirmCompletion(leagueId,staff,preview.token);
    }
   }
   if(step==='PREPARATION') {
    const preview=lifecycle.prepareRollover(leagueId,staff);if(!preview.token)throw Error(preview.blockers.join(' '));const receipt=lifecycle.confirmRollover(leagueId,staff,preview.token);
    runtime.offseasonClock=clock;sim.seasonId=receipt.nextSeasonId;
    const next=repository.loadLeague(leagueId),players=repository.loadPlayers(leagueId),members=activeMemberships(repository.loadRosterMemberships(leagueId),sim.seasonId),needsInput={draftYear:year+1,prospects:[],rosters:Object.fromEntries(next.teams.map(t=>[t.teamId,members.filter(m=>m.teamId===t.teamId).map(m=>players.find(p=>p.playerId===m.playerId))]))};
    runtime.history.push({type:'TEST_MODE_TEAM_NEEDS',seasonId:sim.seasonId,teams:next.teams.map(t=>({teamId:t.teamId,...require('./mock-engine').teamPositionNeeds(needsInput,t.teamId)}))});
    const ranking=require('./power-rankings').createPowerRankingsService({repository}).process(leagueId);if(ranking)runtime.history.push({type:'TEST_MODE_POWER_RANKINGS',seasonId:sim.seasonId,key:ranking.key,teams:ranking.teams});
    await onStage({step:'ROLLOVER',seasonId:initial.seasonId,nextSeasonId:sim.seasonId,receipt});return {phase:'PRESEASON',seasonId:sim.seasonId,offseasonComplete:true};
   }
   const preview=lifecycle.prepare(leagueId,staff);if(!preview.token)throw Error(preview.blockers.join(' '));lifecycle.confirm(leagueId,staff,preview.token);
  }
  runtime.offseasonClock=clock;
  if(await onStage({step,seasonId:initial.seasonId}))return {paused:true,phase:repository.loadLeague(leagueId).league.currentPhase,step:lifecycle.inspect(leagueId).step};
 }
}
module.exports={runSimulationOffseason};
