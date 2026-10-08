const { randomUUID, createHash } = require('crypto');
const { requireCommissioner } = require('./postseason-state');
const { PHASE_BY_STEP } = require('./offseason-state');
const { activeMemberships } = require('./service-helpers');
const { leagueSeasonStartYear } = require('./asset-valuation');
const { createOffseasonEvidenceService } = require('./retirement-import-service');
const { createRookieContract, rookieScale } = require('./rookie-contracts');
const KEYS = { LOTTERY:'lottery', DRAFT:'draft', OPTIONS:'options', PROGRESSION:'progression' };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createOffseasonImportService({ repository, step, now = Date.now, recognize, scoutingService, backup = () => require('./storage-safety').createStorageBackup(repository.dataRoot, { label:'offseason-import' }) }) {
  if (!KEYS[step]) throw Error('Choose lottery, draft, options or progression import.');
  scoutingService ||= require('./scouting-service').createScoutingService({ repository });
  function context(leagueId, actor) {
    const c=repository.loadLeague(leagueId); requireCommissioner(c,actor);
    const state=repository.loadOffseason(leagueId), season=state?.seasons[c.seasonId];
    if (season?.step!==step || c.league.currentPhase!==PHASE_BY_STEP[step]) throw Error('Open the '+step.toLowerCase()+' offseason step first.');
    season.imports ||= {}; const batch=season.imports[KEYS[step]] ||= {images:[],revision:0};
    return {c,state,season,batch};
  }
  function board(leagueId) {
    const c=repository.loadLeague(leagueId), result=scoutingService.boardForContext(c), classId=result.file.replace(/\.json$/i,'');
    return {classId,prospects:result.prospects.map(p=>({...p,playerId:`${classId}:${p.board_number}`}))};
  }
  const evidence=createOffseasonEvidenceService({repository,step,importKey:KEYS[step],now,...(recognize?{recognize}:{}),candidatePool:step==='DRAFT'?leagueId=>board(leagueId).prospects:null});
  function source(leagueId,batch) { return hash([repository.loadLeague(leagueId),repository.loadPlayers(leagueId),repository.loadRosterMemberships(leagueId),repository.loadDraftPicks(leagueId),repository.loadTrades(leagueId),repository.loadFreeAgencyState(leagueId),batch.images,batch.revision,step==='DRAFT'?board(leagueId):null]); }
  function save(leagueId,state,actor,action,metadata,extra=[]) {
    repository.commitLeagueFiles({leagueId,files:[...extra,{name:'offseason.json',value:state},{name:'audit-log.json',value:[...repository.loadAuditLog(leagueId),{action,seasonId:repository.loadLeague(leagueId).seasonId,userId:actor.id,timestamp:new Date(now()).toISOString(),metadata}]}]});
  }
  function inspect(leagueId,actor, salaryCap = null) {
    const {c,batch,season}=context(leagueId,actor), players=repository.loadPlayers(leagueId), members=activeMemberships(repository.loadRosterMemberships(leagueId),c.seasonId);
    const year=leagueSeasonStartYear(c.league.seasonNumber)+1, nextSeason=`${year}-${String(year+1).slice(-2)}`;
    const eligible=step==='DRAFT'?board(leagueId).prospects:players.filter(p=>!p.retiredAt);
    return {...evidence.inspect(leagueId,actor),step,draftYear:year,nextSeason,teams:c.teams,scale:step==='DRAFT'&&salaryCap?rookieScale({draftYear:year,salaryCap:Number(salaryCap)}):null,players:eligible.map(p=>({playerId:p.playerId,name:p.name,overall:p.overall,age:p.age,teamId:members.find(m=>m.playerId===p.playerId)?.teamId||null,position1:p.position1||p.position_1,option:p.contract?.seasons?.find(s=>s.season===nextSeason&&s.option)})),
      picks:repository.loadDraftPicks(leagueId).filter(p=>Number(p.draftYear)===year&&Number(p.round)===(step==='LOTTERY'?1:Number(p.round))),
      review:batch.review||null, receipt:season.receipts?.[step]||null,
      coverage:c.teams.map(t=>({teamId:t.teamId,teamName:t.teamName,rosterCount:members.filter(m=>m.teamId===t.teamId).length,reviewed:(batch.review?.rows||[]).filter(r=>r.teamId===t.teamId).length}))};
  }
  function rowsFor(leagueId,c,season,rows,policy) {
    if (!Array.isArray(rows) || (!rows.length && step !== 'OPTIONS')) throw Error('Review the imported rows before preparing confirmation.');
    const players=repository.loadPlayers(leagueId), memberships=repository.loadRosterMemberships(leagueId), active=activeMemberships(memberships,c.seasonId), picks=repository.loadDraftPicks(leagueId), teams=new Set(c.teams.map(t=>t.teamId));
    const year=leagueSeasonStartYear(c.league.seasonNumber)+1, nextSeason=`${year}-${String(year+1).slice(-2)}`;
    const unique=(key,count)=>{if((count!=null&&rows.length!==count)||rows.some(r=>!r[key])||new Set(rows.map(r=>r[key])).size!==rows.length)throw Error(`Review ${count||'unique'} complete, unique ${key} rows.`);};
    const verifyTeam=id=>{if(!teams.has(id))throw Error('Select a configured team for every row.');};
    if(step==='LOTTERY') {
      unique('pickNumber',30);unique('originalTeamId',30);
      return rows.map(r=>{
        if(!Number.isInteger(r.pickNumber)||r.pickNumber<1||r.pickNumber>30)throw Error('Lottery must contain picks 1–30.');verifyTeam(r.teamId);verifyTeam(r.originalTeamId);
        const asset=picks.find(p=>p.originalTeamId===r.originalTeamId&&Number(p.round)===1&&Number(p.draftYear)===year);
        if(!asset)throw Error('Initialize the matching first-round pick asset first.');
        if(asset.currentOwnerTeamId!==r.teamId&&String(r.reason||'').trim().length<5)throw Error('Pick ownership differs from league records. Enter a reconciliation reason.');
        return {pickNumber:r.pickNumber,originalTeamId:r.originalTeamId,currentOwnerTeamId:r.teamId,originalPickAssetId:asset.pickId,reason:String(r.reason||'').trim()};
      }).sort((a,b)=>a.pickNumber-b.pickNumber);
    }
    if(step==='DRAFT') {
      unique('pickNumber',60);unique('playerId',60);
      const b=board(leagueId);if(b.prospects.length!==75)throw Error('The draft class must contain exactly 75 prospects.');
      rookieScale({draftYear:year,salaryCap:policy.salaryCap});
      const results=rows.map(r=>{
        if(!Number.isInteger(r.pickNumber)||r.pickNumber<1||r.pickNumber>60)throw Error('Draft must contain selections 1–60.');verifyTeam(r.teamId);
        const prospect=b.prospects.find(p=>p.playerId===r.playerId);if(!prospect||players.some(p=>p.playerId===r.playerId))throw Error('Select a unique prospect from this unimported draft class.');
        if(!Number.isInteger(r.overall)||r.overall<1||r.overall>99)throw Error('Review every drafted player’s 1–99 OVR.');
        if(r.age!=null&&(!Number.isInteger(r.age)||r.age<16||r.age>50))throw Error('Review the drafted player age.');
        const round=r.pickNumber<=30?1:2;
        const order=season.receipts?.LOTTERY?.order?.find(p=>p.pickNumber===r.pickNumber);
        const asset=round===1?picks.find(p=>p.pickId===order?.originalPickAssetId):picks.find(p=>p.pickId===r.pickAssetId);
        if(!asset||Number(asset.draftYear)!==year||Number(asset.round)!==round||asset.currentOwnerTeamId!==r.teamId)throw Error('Match each draft selection to its current owned pick asset.');
        const contract=createRookieContract({draftYear:year,pick:r.pickNumber,salaryCap:policy.salaryCap,scalePercentage:policy.scalePercentage??120,secondRoundYears:r.contractYears,firstYearSalary:r.firstYearSalary,secondYearSalary:r.secondYearSalary});
        return {...r,pickAssetId:asset.pickId,contract,prospect};
      });
      if(new Set(results.map(r=>r.pickAssetId)).size!==60)throw Error('A draft pick asset was used more than once.');
      for(const teamId of teams)if(active.filter(m=>m.teamId===teamId).length+results.filter(r=>r.teamId===teamId).length>20)throw Error('The draft would leave a team above the 20-player offseason limit.');
      return results.sort((a,b)=>a.pickNumber-b.pickNumber);
    }
    if(step==='OPTIONS') {
      unique('playerId');
      const expected=players.filter(p=>!p.retiredAt&&p.contract?.seasons?.some(s=>s.season===nextSeason&&s.option&&!s.optionDecision));
      if(rows.length!==expected.length||expected.some(p=>!rows.some(r=>r.playerId===p.playerId)))throw Error('Review every pending next-season option.');
      return rows.map(r=>{
        const p=expected.find(p=>p.playerId===r.playerId), membership=active.find(m=>m.playerId===r.playerId);
        if(!p||!membership||!['ACCEPTED','DECLINED'].includes(r.decision))throw Error('Choose Accepted or Declined for each rostered player’s pending option.');
        const lock=require('./transaction-locks').playerTransactionLock(repository,leagueId,c.seasonId,r.playerId);if(lock)throw Error(lock);
        return {playerId:p.playerId,teamId:membership.teamId,decision:r.decision,season:nextSeason};
      });
    }
    unique('playerId',450);if(c.teams.length!==30)throw Error('Verify all 30 teams.');
    if(active.length!==450||new Set(active.map(m=>m.playerId)).size!==450)throw Error('Complete exact 15-player cutdowns before progression.');
    for(const teamId of teams)if(active.filter(m=>m.teamId===teamId).length!==15||rows.filter(r=>r.teamId===teamId).length!==15)throw Error('Each progression team needs exactly 15 verified players.');
    return rows.map(r=>{
      verifyTeam(r.teamId);const p=players.find(p=>p.playerId===r.playerId&&!p.retiredAt),m=active.find(m=>m.playerId===r.playerId&&m.teamId===r.teamId);
      if(!p||!m)throw Error('Progression roster differs from the active league roster. Resolve the player or team mapping.');
      if(!Number.isInteger(r.overall)||r.overall<1||r.overall>99||!Number.isInteger(p.overall))throw Error('Verify previous and new player OVR.');
      if(!Number.isInteger(r.change)||r.change!==r.overall-p.overall)throw Error('OVR change must match new OVR minus stored OVR.');
      const lock=require('./transaction-locks').playerTransactionLock(repository,leagueId,c.seasonId,r.playerId);if(lock)throw Error(lock);
      return {playerId:r.playerId,teamId:r.teamId,previousOverall:p.overall,overall:r.overall,change:r.change};
    });
  }
  function review(leagueId,actor,{rows,policy={},reviewedAllImages=false}) {
    const {c,state,season,batch}=context(leagueId,actor);if(season.receipts?.[step])throw Error('This import is already confirmed.');
    if(!Array.isArray(rows)||rows.length>450)throw Error('Invalid review rows.');
    batch.review={rows:structuredClone(rows),policy:structuredClone(policy),reviewedAllImages:reviewedAllImages===true};batch.revision++;season.revision++;delete batch.pending;delete season.pending;
    save(leagueId,state,actor,'offseason.'+KEYS[step]+'.review.saved',{rowCount:rows.length});return inspect(leagueId,actor);
  }
  function prepare(leagueId,actor,input) {
    const {c,state,season,batch}=context(leagueId,actor);if(season.receipts?.[step])throw Error('This import is already confirmed.');
    const review=input||batch.review;if(!review?.reviewedAllImages||!batch.images.length||batch.images.some(i=>i.status==='PROCESSING'))throw Error('Upload and review every evidence image before confirmation.');
    for(const image of batch.images)evidence.readOriginal(leagueId,actor,image.imageId);
    const rows=rowsFor(leagueId,c,season,review.rows,review.policy||{});
    const pending={token:randomUUID(),actorId:actor.id,expiresAt:now()+300000,rows,policy:review.policy||{},sourceDigest:source(leagueId,batch)};
    batch.pending=pending;delete season.pending;
    save(leagueId,state,actor,'offseason.'+KEYS[step]+'.prepared',{token:pending.token,rowCount:rows.length});
    return {token:pending.token,step,rowCount:rows.length,summary:step==='DRAFT'?'60 drafted rookies and 15 undrafted free agents':step==='PROGRESSION'?'450 verified players across 30 teams':rows.length+' reviewed rows'};
  }
  function confirm(leagueId,actor,token) {
    const {c,state,season,batch}=context(leagueId,actor),prior=season.receipts?.[step];
    if(prior?.requestId===token){if(prior.confirmedBy!==actor.id)throw Error('Confirmation belongs to another commissioner.');return prior;}
    const pending=batch.pending;
    if(!pending||pending.token!==token||pending.actorId!==actor.id||pending.expiresAt<=now()||pending.sourceDigest!==source(leagueId,batch))throw Error('Import review expired or source data changed. Review again.');
    for(const image of batch.images)evidence.readOriginal(leagueId,actor,image.imageId);
    const at=new Date(now()).toISOString(),players=repository.loadPlayers(leagueId),memberships=repository.loadRosterMemberships(leagueId),picks=repository.loadDraftPicks(leagueId),files=[];
    const receipt={requestId:token,confirmedBy:actor.id,confirmedAt:at,evidenceIds:batch.images.map(i=>i.imageId),rowCount:pending.rows.length};
    if(step==='LOTTERY') {
      receipt.order=pending.rows;
      for(const row of pending.rows){const asset=picks.find(p=>p.pickId===row.originalPickAssetId);asset.ownershipHistory=[...(asset.ownershipHistory||[]),{at,previousOwnerTeamId:asset.currentOwnerTeamId,ownerTeamId:row.currentOwnerTeamId,reason:row.reason,source:'NBA_2K_LOTTERY',requestId:token}];asset.currentOwnerTeamId=row.currentOwnerTeamId;asset.officialPickNumber=row.pickNumber;asset.officialLotterySeasonId=c.seasonId;}
      files.push({name:'draft-picks.json',value:picks});
    } else if(step==='DRAFT') {
      const {prospects,classId}=board(leagueId),year=leagueSeasonStartYear(c.league.seasonNumber)+1;
      for(const prospect of prospects){const selected=pending.rows.find(r=>r.playerId===prospect.playerId);const p={playerId:prospect.playerId,name:prospect.name,teamId:selected?.teamId||null,position1:prospect.position_1,position2:prospect.position_2||null,overall:selected?.overall??prospect.overall,age:selected?.age??prospect.age,yearsInNBA:0,draftYear:year,nbaDebutSeasonId:String(Number(c.league.seasonNumber)+1),draftClassId:classId,portraitPath:prospect.imagePath||null,imageUrl:prospect.imagePath?'/draft-assets/'+require('path').relative(require('path').join(process.cwd(),'draft_class','images'),prospect.imagePath).split(require('path').sep).map(encodeURIComponent).join('/'):null,scouting:prospect,draftHistory:[{seasonId:c.seasonId,draftYear:year,pickNumber:selected?.pickNumber||null,teamId:selected?.teamId||null,requestId:token}],contract:selected?.contract||null};players.push(p);if(selected){memberships.push({membershipId:randomUUID(),playerId:p.playerId,teamId:selected.teamId,seasonId:c.seasonId,active:true,startedAt:at,position1:p.position1,position2:p.position2,source:'NBA_2K_DRAFT'});const asset=picks.find(pick=>pick.pickId===selected.pickAssetId);asset.selectedPlayerId=p.playerId;asset.selectionHistory=[...(asset.selectionHistory||[]),{playerId:p.playerId,pickNumber:selected.pickNumber,seasonId:c.seasonId,at}];}}
      receipt.draftClassId=classId;receipt.draftedPlayerIds=pending.rows.map(r=>r.playerId);receipt.undraftedPlayerIds=prospects.filter(p=>!pending.rows.some(r=>r.playerId===p.playerId)).map(p=>p.playerId);
      files.push({name:'players.json',value:players},{name:'roster-memberships.json',value:memberships},{name:'draft-picks.json',value:picks});
    } else if(step==='OPTIONS') {
      for(const row of pending.rows){const p=players.find(p=>p.playerId===row.playerId);p.contractHistory=[...(p.contractHistory||[]),{at,reason:'OPTION_'+row.decision,contract:structuredClone(p.contract),teamId:row.teamId}];p.contract.seasons.find(s=>s.season===row.season).optionDecision=row.decision;if(row.decision==='DECLINED'){p.lastTeamId=row.teamId;p.teamId=null;p.contract.seasons=p.contract.seasons.filter(s=>s.season<row.season);p.contract.guaranteedTotal=p.contract.seasons.filter(s=>!s.option).reduce((n,s)=>n+s.salary,0);for(const m of memberships)if(m.playerId===p.playerId&&String(m.seasonId)===c.seasonId&&m.active!==false&&!m.endedAt){m.active=false;m.endedAt=at;m.endedReason='OPTION_DECLINED';}}}
      receipt.decisions=pending.rows;files.push({name:'players.json',value:players},{name:'roster-memberships.json',value:memberships});
    } else {
      for(const row of pending.rows){const p=players.find(p=>p.playerId===row.playerId);p.progressionHistory=[...(p.progressionHistory||[]),{...row,teamName:c.teams.find(t=>t.teamId===row.teamId)?.teamName,seasonId:c.seasonId,confirmedAt:at,requestId:token,evidenceIds:receipt.evidenceIds}];p.overall=row.overall;p.updatedAt=at;}
      receipt.changes=pending.rows;receipt.verifiedTeamIds=c.teams.map(t=>t.teamId);files.push({name:'players.json',value:players});
      if (pending.policy.preserveExistingSchedule === true) season.schedulePolicy = 'CONFERENCE_ROUND_ROBIN_15';
      (season.receipts ||= {}).PREPARATION={...receipt,source:'PROGRESSION_FINAL_ROSTER_VERIFICATION'};
    }
    const safety=backup();season.receipts ||= {};season.receipts[step]=receipt;season.revision++;delete batch.pending;delete season.pending;
    save(leagueId,state,actor,'offseason.'+KEYS[step]+'.confirmed',{...receipt,backupId:safety?.id||null},files);return receipt;
  }
  return {...evidence,inspect,review,prepare,confirm};
}
module.exports={createOffseasonImportService,KEYS};
