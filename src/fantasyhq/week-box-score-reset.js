const fs=require('fs'),path=require('path'),{randomUUID,createHash}=require('crypto');
const previews=new Map();
const fingerprint=r=>createHash('sha256').update(JSON.stringify([r.game.status,r.game.result,r.submissions,r.media,r.extractions,r.playerGameStats,r.teamGameStats,r.dnpPlayers])).digest('hex');
function createWeekBoxScoreReset({submissions,backup=()=>require('./storage-safety').createStorageBackup(submissions.repository.dataRoot,{label:'before-week-box-score-reset'})}){
 const repository=submissions.repository;
 function inspect(guildId,week){
  const c=repository.loadLeagueContext({guildId});
  if(c.league.currentPhase!=='REGULAR_SEASON'||week!==c.league.currentWeek)throw Error('Only the active regular-season week can be cleared.');
  const schedule=repository.loadSchedule(c.league.leagueId,c.seasonId),w=schedule.weeks.find(w=>w.week===week);
  if(!w||w.status!=='ACTIVE'||schedule.statsPublication?.throughWeek>=week)throw Error('Published or closed weeks cannot be cleared with this tool.');
  const records=submissions.records().filter(r=>r.game.leagueId===c.league.leagueId&&r.game.seasonId===c.seasonId&&r.game.weekId===w.weekId&&!r.game.seriesId);
  for(const r of records){
   if(r.game.result||r.game.finalizedAt||r.game.locked||r.game.status==='FINAL')throw Error('An official result exists. Reverse it through Staff review before clearing uploads.');
   if(require('./box-score/service').isExtractionRunning(repository.dataRoot,r.game.gameId))throw Error('Box scores are processing. Wait for extraction to finish before clearing.');
  }
  return {c,records,week};
 }
 function prepare(guildId,actor,week){
  if(!actor?.authorized||!actor.id)throw Error('Commissioner authorization required.');
  const s=inspect(guildId,week),token=randomUUID();
  const snapshots=s.records.map(r=>({id:r.game.gameId,digest:fingerprint(r)}));
  for(const [id,p]of previews)if(p.expiresAt<Date.now())previews.delete(id);
  previews.set(token,{guildId,actorId:actor.id,root:repository.dataRoot,leagueId:s.c.league.leagueId,seasonId:s.c.seasonId,week,snapshots,expiresAt:Date.now()+300000});
  return {token,leagueId:s.c.league.leagueId,seasonId:s.c.seasonId,week,games:s.records.length,submissions:s.records.reduce((n,r)=>n+r.submissions.length,0),images:s.records.reduce((n,r)=>n+r.media.length,0),extractions:s.records.reduce((n,r)=>n+(r.extractions?.length||0),0)};
 }
 async function clear(guildId,actor,token){
  const p=previews.get(token);
  if(!actor?.authorized||!p||p.actorId!==actor.id||p.guildId!==guildId||p.root!==repository.dataRoot||p.expiresAt<Date.now())throw Error('Reset preview expired or belongs to another commissioner.');
  const s=inspect(guildId,p.week);
  if(s.c.league.leagueId!==p.leagueId||s.c.seasonId!==p.seasonId||JSON.stringify(s.records.map(r=>({id:r.game.gameId,digest:fingerprint(r)})))!==JSON.stringify(p.snapshots))throw Error('Week data changed. Preview again before clearing.');
  const safety=backup(),archive=path.join(repository.dataRoot,'box-score-reset-archives',token);
  fs.mkdirSync(archive,{recursive:true});
  const receipt={id:token,leagueId:p.leagueId,seasonId:p.seasonId,week:p.week,backupId:safety.id,actorId:actor.id,at:new Date().toISOString(),cleared:[]};
  // Each record is reset under the same lock as uploads and extraction writes.
  for(const snap of p.snapshots){
   await submissions.mutate(snap.id,r=>{
    if(fingerprint(r)!==snap.digest||require('./box-score/service').isExtractionRunning(repository.dataRoot,snap.id))throw Error('Game changed during reset; re-preview the remaining records.');
    const dir=path.join(repository.dataRoot,'game-history',snap.id),target=path.join(archive,snap.id);
    fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'record.json'),JSON.stringify(r,null,2));
    for(const m of r.media){const file=path.resolve(dir,m.storedFile);if(!file.startsWith(dir+path.sep))throw Error('Invalid stored media path.');if(fs.existsSync(file)){const destination=path.join(target,m.storedFile);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination);}}
    const media=r.media;
    receipt.cleared.push({gameId:snap.id,submissions:r.submissions.length,images:media.length,extractions:r.extractions?.length||0});
    r.submissions=[];r.media=[];r.extractions=[];r.playerGameStats=[];r.teamGameStats=[];r.dnpPlayers=[];r.resultRevisions=[];r.reviewDecisions=[];
    r.game.status='SCHEDULED';delete r.game.activityCard;
    r.boxScoreResets=[...(r.boxScoreResets||[]),{id:token,at:receipt.at,actorId:actor.id,backupId:safety.id}];
   });
   const old=s.records.find(r=>r.game.gameId===snap.id);
   for(const m of old.media){const file=path.resolve(repository.dataRoot,'game-history',snap.id,m.storedFile);if(fs.existsSync(file))fs.unlinkSync(file);}
  }
  fs.writeFileSync(path.join(archive,'receipt.json'),JSON.stringify(receipt,null,2));
  repository.appendAuditLog(p.leagueId,{action:'week.box-scores.cleared',userId:actor.id,timestamp:receipt.at,metadata:receipt});
  previews.delete(token);return receipt;
 }
 return {prepare,clear};
}
module.exports={createWeekBoxScoreReset};
