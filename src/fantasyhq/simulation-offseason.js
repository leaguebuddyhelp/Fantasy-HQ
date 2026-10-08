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
   player.contract=require('./offer-score').normalizeOffer({salary:1000000,years:'3',structure:'Flat',option:'None'},{year:year-1}).contract;
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
    } else if(step==='TRADES'||step==='CUTDOWN') {
     const service=require('./offseason-roster-service').createOffseasonRosterService({repository,now,backup});
     if(step==='CUTDOWN') {
      service.windowAction(leagueId,staff,{action:'open'});
      for(const team of initial.teams) {
       let view=service.inspect(leagueId).teams.find(t=>t.teamId===team.teamId);
       while(view.count>15) {
        const player=view.players.filter(p=>!p.protected).sort((a,b)=>a.overall-b.overall||a.playerId.localeCompare(b.playerId))[0];
        if(!player)throw Error(`${team.teamName}: simulated cutdown cannot waive protected 85+ players. Trade players manually or restore an earlier checkpoint.`);
        const coach={id:owners.find(o=>o.teamId===team.teamId).userId},preview=service.prepareWaiver(leagueId,coach,player.playerId);service.confirmWaiver(leagueId,coach,preview.token);view=service.inspect(leagueId).teams.find(t=>t.teamId===team.teamId);
       }
      }
     }
     const preview=service.prepareCompletion(leagueId,staff);if(!preview.token)throw Error(preview.blockers.join(' '));service.confirmCompletion(leagueId,staff,preview.token);
    } else if(step==='FREE_AGENCY') {
     const service=require('./offseason-free-agency').createOffseasonFreeAgencyService({repository,now,recognize,backup});
     for(let index=0;index<4;index++) {
      let market=service.inspect(leagueId,staff,{staff:true});if(market.stages[index]?.status==='COMPLETED')continue;
      if(!market.stages[index])market=service.stageAction(leagueId,staff,{action:'open'});
      if(market.stage.status==='OPEN') {
       for(const team of initial.teams) {
        const coach={id:owners.find(o=>o.teamId===team.teamId).userId},eligible=service.inspect(leagueId,coach,{teamId:team.teamId}).players;
        const rosterCount=activeMemberships(repository.loadRosterMemberships(leagueId),initial.seasonId).filter(m=>m.teamId===team.teamId).length;
        const target=index===0?5:Math.min(3,Math.max(0,15-rosterCount)+(index===3&&team.teamId===initial.teams[0].teamId&&rosterCount<20?1:0));
        for(const [priority,p] of eligible.sort((a,b)=>b.overall-a.overall||a.playerId.localeCompare(b.playerId)).slice(0,target).entries()) {
         // Avoid multi-team fixture bids so approval exercises actual eligibility and
         // limits without forcing a predetermined winner against a competing offer.
         const current=service.inspect(leagueId,staff,{staff:true});if(current.offers.some(o=>o.stageId===current.stage.id&&o.playerId===p.playerId&&o.status==='ACTIVE'))continue;
         service.offer(leagueId,coach,{teamId:team.teamId,playerId:p.playerId,priority:priority+1,details:{salary:Math.max(1000000,(p.overall-60)*500000),years:'3',structure:'Flat',option:'None'},requestId:`TEST_MODE:${sim.id}:${initial.seasonId}:${index}:${p.playerId}`});
        }
       }
       clock=Date.parse(market.stage.deadlineAt)+1;runtime.offseasonClock=clock;service.stageAction(leagueId,staff,{action:'close'});
      }
      market=service.inspect(leagueId,staff,{staff:true});const active=market.offers.filter(o=>o.stageId===market.stage.id&&o.status==='ACTIVE');
      if(active.length){const preview=service.prepareApproval(leagueId,staff,active.map(o=>o.id));service.confirmApproval(leagueId,staff,preview.token);}
      service.stageAction(leagueId,staff,{action:'complete'});
     }
     const won=service.inspect(leagueId,staff,{staff:true}).offers.filter(o=>o.status==='WON');
     if(!service.inspect(leagueId,staff,{staff:true}).evidence.images.length)await service.upload(leagueId,staff,{filename:'TEST-MODE-TRANSACTION-REPORT.png',bytes:await require('sharp')({create:{width:80,height:80,channels:3,background:'white'}}).png().toBuffer()});
     const rows=won.map(o=>({offerId:o.id,playerId:o.playerId,teamId:o.teamId,details:{salary:o.contract.seasons[0].salary,years:'3',structure:'Flat',option:'None'}}));
     const preview=service.prepareVerification(leagueId,staff,{rows,reviewedAllImages:true});service.confirmVerification(leagueId,staff,preview.token);
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
