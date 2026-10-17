const fs=require('fs'),path=require('path'),{randomUUID,createHash}=require('crypto');
const {activeMemberships}=require('./service-helpers');
const {parseReportRow,recognizeTransactionReport}=require('./transaction-report-ocr');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createRosterPhotoSync({repository,recognize=recognizeTransactionReport,backup=()=>require('./storage-safety').createStorageBackup(repository.dataRoot,{label:'before-roster-photo-sync'}),onRosterMovement=null}){
 function context(leagueId,actor){const c=repository.loadLeague(leagueId);if(!actor?.authorized||actor.id!==c.league.commissionerUserId)throw Error('Commissioner authorization required.');return c;}
 function directory(c,id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid roster upload.');return path.join(c.paths.leagueRoot,'roster-photo-sync',id);}
 function save(c,b){require('./simulation-storage').atomic(path.join(directory(c,b.id),'batch.json'),b);}
 function load(leagueId,actor,id){const c=context(leagueId,actor),b=JSON.parse(fs.readFileSync(path.join(directory(c,id),'batch.json'),'utf8'));if(b.actorId!==actor.id||b.seasonId!==c.seasonId||b.leagueId!==leagueId)throw Error('Upload belongs to another commissioner or season.');return {c,b};}
 const ledger=c=>{const file=path.join(c.paths.leagueRoot,'roster-photo-events.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];};
 function view(c,b){const members=activeMemberships(repository.loadRosterMemberships(b.leagueId),c.seasonId);return {...b,teams:c.teams,players:repository.loadPlayers(b.leagueId).filter(p=>!p.retiredAt).map(p=>({playerId:p.playerId,name:p.name,teamId:members.find(m=>m.playerId===p.playerId)?.teamId||null,checkpoint:p.rosterPhotoCheckpoint||null}))};}
 function start(leagueId,actor){const c=context(leagueId,actor),b={id:randomUUID(),leagueId,seasonId:c.seasonId,actorId:actor.id,createdAt:new Date().toISOString(),images:[]};save(c,b);return view(c,b);}
 async function upload(leagueId,actor,id,{bytes,filename}){
  let {c,b}=load(leagueId,actor,id);if(b.receipt)throw Error('This update is already saved.');if(b.images.length>=12)throw Error('Use up to 12 photos per update.');
  await require('./offseason-image').metadata(bytes);
  // Re-read after decoding validation: parallel requests cannot overwrite each other's entries.
  ({c,b}=load(leagueId,actor,id));if(b.receipt||b.images.length>=12)throw Error('This upload batch is closed or full.');
  const imageId=randomUUID();fs.writeFileSync(path.join(directory(c,id),imageId+'.original'),bytes,{flag:'wx'});
  b.images.push({imageId,filename:String(filename||'Transaction Report').slice(0,150),sha256:createHash('sha256').update(bytes).digest('hex'),status:'PROCESSING'});delete b.preview;save(c,b);
  let result,error;try{result=await recognize(await require('./offseason-image').normalize(bytes));if(!Array.isArray(result?.rows))throw Error('The report could not be read. Retry with a clearer photo.');}catch(e){error=e.message;}
  ({c,b}=load(leagueId,actor,id));const image=b.images.find(i=>i.imageId===imageId);
  if(error)Object.assign(image,{status:'FAILED',error});else{
   const pool=repository.loadPlayers(leagueId).filter(p=>!p.retiredAt);
   Object.assign(image,{status:'READ',text:result.text,rows:result.rows.map(row=>({...parseReportRow(row,pool,c.teams),readings:row.readings}))});
  }
  delete b.preview;save(c,b);return view(c,b);
 }
 function source(c,b){return digest([c.league,repository.loadPlayers(b.leagueId),repository.loadRosterMemberships(b.leagueId),repository.loadTrades(b.leagueId),repository.loadOffseason(b.leagueId),ledger(c),b.images]);}
 function prepare(leagueId,actor,id,{rows,resolutions={},reviewedAllImages,ignoredImages=[]}){
  const {c,b}=load(leagueId,actor,id);if(b.receipt)throw Error('This update is already saved.');
  if(!reviewedAllImages||!b.images.length||b.images.some(i=>i.status==='PROCESSING'))throw Error('Wait for processing and review every photo first.');
  const ignored=new Set(ignoredImages);if([...ignored].some(id=>!b.images.some(i=>i.imageId===id)))throw Error('Unknown ignored photo.');
  const images=b.images.filter(i=>!ignored.has(i.imageId));if(!images.length||images.some(i=>i.status!=='READ'||!i.rows.length))throw Error('Unreadable photos must be retried or explicitly excluded.');
  const expected=images.flatMap(i=>i.rows.map((r,index)=>i.imageId+':'+index)),seen=new Set(),events=[],pool=repository.loadPlayers(leagueId).filter(p=>!p.retiredAt),history=ledger(c),keys=new Set(history.filter(e=>e.seasonId===c.seasonId).map(e=>e.key));
  if(!Array.isArray(rows)||rows.length>300)throw Error('Review the detected transaction rows.');
  let duplicates=0;const newPlayers=new Map(),resolutionKeys=new Map();
  for(const row of rows){if(!expected.includes(row.key)||seen.has(row.key))throw Error('Review each detected row once.');seen.add(row.key);if(row.ignore===true)continue;
   let p=pool.find(p=>p.playerId===row.playerId);
   if(row.playerId==='__NEW__'){
    const name=String(row.newPlayerName||'').trim(),position=String(row.newPlayerPosition||'');
    if(name.length<3||name.length>100||!/[A-Za-z]/.test(name)||!['PG','SG','SF','PF','C'].includes(position))throw Error('Enter the new player’s name and primary position from the report.');
    const normalized=require('./service-helpers').normalizeText(name);
    if(repository.loadPlayers(leagueId).some(other=>require('./service-helpers').normalizeText(other.name)===normalized))throw Error('That player name already exists. Match the existing player instead.');
    p=newPlayers.get(normalized);if(!p){p={playerId:'ply_'+randomUUID().replaceAll('-','').slice(0,16),name,position1:position,position2:null,overall:null,age:null,yearsInNBA:null,teamId:null,source:'TRANSACTION_REPORT_SYNC'};newPlayers.set(normalized,p);resolutionKeys.set(p.playerId,'NEW:'+normalized);pool.push(p);}
    else if(p.position1!==position)throw Error('The new player’s position differs across photos. Review the rows.');
   }
   if(!p||!c.teams.some(t=>t.teamId===row.teamId)||!['SIGN','WAIVE'].includes(row.type))throw Error('Match every included transaction to its player, team and type.');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||new Date(row.date+'T00:00:00Z').toISOString().slice(0,10)!==row.date)throw Error('Enter a valid transaction date.');
   const currentYear=require('./asset-valuation').leagueSeasonStartYear(c.league.seasonNumber);
   if(Number(row.date.slice(0,4))<currentYear||Number(row.date.slice(0,4))>currentYear+1)throw Error('Transaction date is outside the active league year.');
   const years=row.reportedYears==null||row.reportedYears===''?null:Number(row.reportedYears),total=row.reportedTotal==null||row.reportedTotal===''?null:Number(row.reportedTotal);
   if(years!==null&&(!Number.isInteger(years)||years<1||years>10)||total!==null&&(!Number.isSafeInteger(total)||total<=0))throw Error('Contract years and total must be positive values or blank.');
   const event={playerId:p.playerId,name:p.name,teamId:row.teamId,type:row.type,date:row.date,reportedYears:row.type==='SIGN'?years:null,reportedTotal:row.type==='SIGN'?total:null,seasonId:c.seasonId};
   // Identity excludes OCR contract rounding; conflicting copies require review.
   event.key=digest([c.seasonId,event.date,event.type,event.teamId,event.playerId]);
   const prior=events.find(e=>e.key===event.key);
   if(prior){if(prior.reportedTotal!==null&&event.reportedTotal!==null&&prior.reportedTotal!==event.reportedTotal||prior.reportedYears!==null&&event.reportedYears!==null&&prior.reportedYears!==event.reportedYears)throw Error(p.name+': duplicate photos disagree on contract terms. Correct or exclude the conflicting row.');prior.reportedTotal??=event.reportedTotal;prior.reportedYears??=event.reportedYears;duplicates++;continue;}
   if(keys.has(event.key)){duplicates++;continue;}events.push(event);
  }
  if(seen.size!==expected.length)throw Error('Review or explicitly exclude every detected row.');
  const members=activeMemberships(repository.loadRosterMemberships(leagueId),c.seasonId),changes=[],older=[];
  for(const playerId of new Set(events.map(e=>e.playerId))){
   const p=pool.find(p=>p.playerId===playerId),mine=events.filter(e=>e.playerId===playerId),latestDate=mine.map(e=>e.date).sort().at(-1),checkpoint=p.rosterPhotoCheckpoint?.seasonId===c.seasonId?p.rosterPhotoCheckpoint:null;
   if(checkpoint&&checkpoint.date>latestDate){older.push(p.name);continue;}
   const last=mine.filter(e=>e.date===latestDate),destinations=[...new Set(last.map(e=>e.type==='SIGN'?e.teamId:null))];
   if(checkpoint?.date===latestDate&&!destinations.includes(checkpoint.teamId))destinations.push(checkpoint.teamId);
   let toTeamId=destinations[0];if(destinations.length>1){const resolutionKey=resolutionKeys.get(playerId)||playerId;if(!Object.hasOwn(resolutions,resolutionKey)||!destinations.includes(resolutions[resolutionKey]))throw Error(p.name+': confirm the final team or Free agency for '+latestDate+'.');toTeamId=resolutions[resolutionKey];}
   const membership=members.filter(m=>m.playerId===playerId);if(membership.length>1)throw Error(p.name+': duplicate active memberships need review.');
   const fromTeamId=membership[0]?.teamId||null;
   const warnings=toTeamId===null&&fromTeamId&&!last.some(e=>e.type==='WAIVE'&&e.teamId===fromTeamId)?['The report’s waiver team differs from the app’s roster. Confirm this is the player’s latest status in 2K.']:[];
   if(toTeamId!==fromTeamId){const lock=require('./transaction-locks').playerTransactionLock(repository,leagueId,c.seasonId,playerId);if(lock)throw Error(p.name+': '+lock);
   }
   const contractEvent=last.find(e=>e.type==='SIGN'&&e.teamId===toTeamId);
   changes.push({playerId,name:p.name,fromTeamId,toTeamId,date:latestDate,warnings,reportedYears:contractEvent?.reportedYears||null,reportedTotal:contractEvent?.reportedTotal??null,contractReported:Boolean(contractEvent)});
  }
  b.preview={token:randomUUID(),source:source(c,b),expiresAt:Date.now()+300000,events,changes,newPlayers:[...newPlayers.values()],duplicates,older,ignoredImages:[...ignored]};save(c,b);return b.preview;
 }
 function confirm(leagueId,actor,id,token){
  const {c,b}=load(leagueId,actor,id);if(b.receipt?.token===token)return b.receipt;
  const preview=b.preview;if(!preview||preview.token!==token||preview.expiresAt<Date.now()||preview.source!==source(c,b))throw Error('Roster data changed or the preview expired. Review again.');
  const safety=backup(),at=new Date().toISOString(),pool=repository.loadPlayers(leagueId),members=repository.loadRosterMemberships(leagueId);
  pool.push(...(preview.newPlayers||[]));
  for(const change of preview.changes){const p=pool.find(p=>p.playerId===change.playerId);
   if(change.fromTeamId!==change.toTeamId){for(const m of activeMemberships(members,c.seasonId).filter(m=>m.playerId===p.playerId)){m.active=false;m.endedAt=at;m.endedReason='TRANSACTION_REPORT_SYNC';}
    if(change.toTeamId)members.push({membershipId:randomUUID(),seasonId:c.seasonId,playerId:p.playerId,teamId:change.toTeamId,active:true,startedAt:at,source:'TRANSACTION_REPORT_SYNC',position1:p.position1,position2:p.position2});
    p.lastTeamId=change.fromTeamId;p.teamId=change.toTeamId;
   }
   if(!change.toTeamId){if(p.contract)p.contractHistory=[...(p.contractHistory||[]),{at,reason:'TRANSACTION_REPORT_WAIVER',teamId:change.fromTeamId,contract:p.contract}];delete p.contract;}
   else if(change.reportedYears||change.reportedTotal){
    const seasons=p.contract?.seasons||[],known=seasons.filter(s=>Number.isFinite(s.salary));
    const matches=known.length===change.reportedYears&&Math.abs(known.reduce((n,s)=>n+s.salary,0)-change.reportedTotal)<=5000;
    if(!matches){if(p.contract)p.contractHistory=[...(p.contractHistory||[]),{at,reason:'TRANSACTION_REPORT_SIGNING',teamId:change.fromTeamId,contract:p.contract}];p.contract={source:'nba2k-transaction-report',reportedYears:change.reportedYears,reportedTotal:change.reportedTotal,seasons:[],guaranteedTotal:null,currency:'USD',fetchedAt:at};}
   }else if(change.contractReported||change.fromTeamId!==change.toTeamId){if(p.contract)p.contractHistory=[...(p.contractHistory||[]),{at,reason:'TRANSACTION_REPORT_SIGNING',teamId:change.fromTeamId,contract:p.contract}];delete p.contract;}
   p.rosterPhotoCheckpoint={seasonId:c.seasonId,date:change.date,teamId:change.toTeamId,batchId:id,verifiedAt:at};p.updatedAt=at;
  }
  const history=ledger(c);history.push(...preview.events.map(e=>({...e,batchId:id,verifiedBy:actor.id,verifiedAt:at})));
  b.receipt={token,at,actorId:actor.id,backupId:safety.id,changes:preview.changes,duplicates:preview.duplicates,older:preview.older,evidenceIds:b.images.map(i=>i.imageId)};delete b.preview;
  const offseason=repository.loadOffseason(leagueId),season=offseason?.seasons[c.seasonId],extra=[];
  if(preview.events.length&&season&&['TRADES','FREE_AGENCY','CUTDOWN'].includes(season.step)){
   delete season.receipts?.[season.step];delete season.pending;delete season.staffCompletion;season.revision++;
   extra.push({name:'offseason.json',value:offseason});
  }
  repository.commitLeagueFiles({leagueId,files:[...extra,{name:'players.json',value:pool},{name:'roster-memberships.json',value:members},{name:'roster-photo-events.json',value:history},{name:`roster-photo-sync/${id}/batch.json`,value:b},{name:'audit-log.json',value:[...repository.loadAuditLog(leagueId),{action:'roster.photos.synced',userId:actor.id,timestamp:at,metadata:b.receipt}]}]});
  if(onRosterMovement)try{Promise.resolve(onRosterMovement({leagueId,seasonId:c.seasonId,playerIds:preview.changes.filter(c=>c.fromTeamId!==c.toTeamId).map(c=>c.playerId),reason:'TRANSACTION_REPORT_SYNC'})).catch(e=>console.error('Roster photo sync follow-up:',e.message));}catch(e){console.error('Roster photo sync follow-up:',e.message);}
  return b.receipt;
 }
 async function original(leagueId,actor,id,imageId){const {c,b}=load(leagueId,actor,id);if(!b.images.some(i=>i.imageId===imageId))throw Error('Unknown photo.');return require('./offseason-image').normalize(fs.readFileSync(path.join(directory(c,id),imageId+'.original')));}
 return {start,upload,prepare,confirm,original,inspect:(leagueId,actor,id)=>{const {c,b}=load(leagueId,actor,id);return view(c,b);}};
}
module.exports={createRosterPhotoSync};
