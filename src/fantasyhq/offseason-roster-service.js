const {randomUUID,createHash}=require('crypto');
const {requireCommissioner}=require('./postseason-state');
const {activeMemberships}=require('./service-helpers');
const {ACTIVE_TRADES}=require('./transaction-locks');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createOffseasonRosterService({repository,now=Date.now,backup=()=>require('./storage-safety').createStorageBackup(repository.dataRoot,{label:'offseason-roster'})}){
 function context(leagueId,actor,commissioner=true){const c=repository.loadLeague(leagueId);if(commissioner)requireCommissioner(c,actor);const state=repository.loadOffseason(leagueId),season=state?.seasons[c.seasonId];if(!['OFFSEASON','FREE_AGENCY'].includes(c.league.currentPhase)||!['TRADES','CUTDOWN','FREE_AGENCY'].includes(season?.step))throw Error('Open the offseason trades, free agency roster review or cutdown step first.');return {c,state,season};}
 function inspect(leagueId){const {c,season}=context(leagueId,null,false),players=repository.loadPlayers(leagueId),members=activeMemberships(repository.loadRosterMemberships(leagueId),c.seasonId),blockers=[];
  const pendingTrades=repository.loadTrades(leagueId).filter(t=>String(t.seasonId)===c.seasonId&&ACTIVE_TRADES.has(t.status));if(pendingTrades.length)blockers.push(pendingTrades.length+' unresolved trades.');
  if(c.teams.length!==30)blockers.push('Exactly 30 teams are required.');
  if(new Set(members.map(m=>m.playerId)).size!==members.length||members.some(m=>!players.some(p=>p.playerId===m.playerId&&!p.retiredAt)||!c.teams.some(t=>t.teamId===m.teamId)))blockers.push('Resolve invalid roster memberships.');
  const teams=c.teams.map(team=>({...team,players:members.filter(m=>m.teamId===team.teamId).map(m=>{const p=players.find(p=>p.playerId===m.playerId);return {playerId:m.playerId,name:p?.name||m.playerId,overall:p?.overall};}),count:members.filter(m=>m.teamId===team.teamId).length}));
  if(season.step==='TRADES')for(const team of teams)if(team.count>20)blockers.push(`${team.teamName}: reduce the roster to the temporary 20-player limit.`);
  if(season.step==='CUTDOWN')for(const team of teams)if(team.count<14||team.count>15)blockers.push(`${team.teamName}: ${team.count} players; require 14–15.`);
  return {step:season.step,seasonId:c.seasonId,window:season.cutdowns||null,teams,blockers,ready:!blockers.length,receipt:season.receipts?.[season.step]||null};
 }
 function source(leagueId){return hash([repository.loadLeague(leagueId).league,repository.loadPlayers(leagueId),repository.loadRosterMemberships(leagueId),repository.loadOwners(leagueId),repository.loadTrades(leagueId)]);}
 function save(leagueId,state,actor,action,metadata,files=[]){repository.commitLeagueFiles({leagueId,files:[...files,{name:'offseason.json',value:state},{name:'audit-log.json',value:[...repository.loadAuditLog(leagueId),{action,seasonId:repository.loadLeague(leagueId).seasonId,userId:actor.id,timestamp:new Date(now()).toISOString(),metadata}]}]});}
 function prepareCompletion(leagueId,actor){const {state,season}=context(leagueId,actor),view=inspect(leagueId);if(view.receipt)return view;if(!view.ready) return view;
  const pending={token:randomUUID(),actorId:actor.id,step:season.step,expiresAt:now()+300000,sourceDigest:source(leagueId)};season.staffCompletion=pending;save(leagueId,state,actor,'offseason.'+season.step.toLowerCase()+'.completion.prepared',{token:pending.token});return {...view,token:pending.token};}
 function confirmCompletion(leagueId,actor,token){const {state,season}=context(leagueId,actor);if(season.receipts?.[season.step]?.requestId===token)return season.receipts[season.step];const p=season.staffCompletion;if(!p||p.token!==token||p.actorId!==actor.id||p.step!==season.step||p.expiresAt<=now()||p.sourceDigest!==source(leagueId)||!inspect(leagueId).ready)throw Error('Completion review expired or changed. Review again.');
  const receipt={requestId:token,confirmedBy:actor.id,confirmedAt:new Date(now()).toISOString(),rosterSource:source(leagueId),mode:'TRANSACTION_REPORT_RECONCILIATION'};season.receipts ||= {};season.receipts[season.step]=receipt;season.revision++;delete season.staffCompletion;delete season.pending;backup();save(leagueId,state,actor,'offseason.'+season.step.toLowerCase()+'.completed',receipt);return receipt;}
 return {inspect,prepareCompletion,confirmCompletion};
}
module.exports={createOffseasonRosterService};
