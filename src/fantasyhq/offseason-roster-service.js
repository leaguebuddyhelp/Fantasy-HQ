const {randomUUID,createHash}=require('crypto');
const {requireCommissioner}=require('./postseason-state');
const {activeMemberships}=require('./service-helpers');
const {ACTIVE_TRADES,ACTIVE_WINDOWS,LIVE_OFFERS,playerTransactionLock}=require('./transaction-locks');
const HOUR=3600000;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createOffseasonRosterService({repository,now=Date.now,backup=()=>require('./storage-safety').createStorageBackup(repository.dataRoot,{label:'offseason-roster'})}){
 function context(leagueId,actor,commissioner=true){const c=repository.loadLeague(leagueId);if(commissioner)requireCommissioner(c,actor);const state=repository.loadOffseason(leagueId),season=state?.seasons[c.seasonId];if(c.league.currentPhase!=='OFFSEASON'||!['TRADES','CUTDOWN'].includes(season?.step))throw Error('Open the offseason trades or roster cutdown step first.');return {c,state,season};}
 function inspect(leagueId){const {c,season}=context(leagueId,null,false),players=repository.loadPlayers(leagueId),members=activeMemberships(repository.loadRosterMemberships(leagueId),c.seasonId),fa=repository.loadFreeAgencyState(leagueId),blockers=[];
  const pendingTrades=repository.loadTrades(leagueId).filter(t=>String(t.seasonId)===c.seasonId&&ACTIVE_TRADES.has(t.status));if(pendingTrades.length)blockers.push(pendingTrades.length+' unresolved trades.');
  if(fa.windows.some(w=>String(w.seasonId)===c.seasonId&&ACTIVE_WINDOWS.has(w.status))||fa.offers.some(o=>String(o.seasonId)===c.seasonId&&LIVE_OFFERS.has(o.status))||fa.waivers.some(w=>String(w.seasonId)===c.seasonId&&w.status==='PENDING'))blockers.push('Resolve pending offers and waivers.');
  if(c.teams.length!==30)blockers.push('Exactly 30 teams are required.');
  if(new Set(members.map(m=>m.playerId)).size!==members.length||members.some(m=>!players.some(p=>p.playerId===m.playerId&&!p.retiredAt)||!c.teams.some(t=>t.teamId===m.teamId)))blockers.push('Resolve invalid roster memberships.');
  const teams=c.teams.map(team=>({...team,players:members.filter(m=>m.teamId===team.teamId).map(m=>{const p=players.find(p=>p.playerId===m.playerId);return {playerId:m.playerId,name:p?.name||m.playerId,overall:p?.overall,protected:Number(p?.overall)>=85};}),count:members.filter(m=>m.teamId===team.teamId).length}));
  if(season.step==='TRADES')for(const team of teams)if(team.count>20)blockers.push(`${team.teamName}: reduce the roster to the temporary 20-player limit.`);
  if(season.step==='CUTDOWN')for(const team of teams)if(team.count!==15)blockers.push(`${team.teamName}: ${team.count}/15 players.`);
  return {step:season.step,seasonId:c.seasonId,window:season.cutdowns||null,teams,blockers,ready:!blockers.length,receipt:season.receipts?.[season.step]||null};
 }
 function source(leagueId){return hash([repository.loadPlayers(leagueId),repository.loadRosterMemberships(leagueId),repository.loadOwners(leagueId),repository.loadTrades(leagueId),repository.loadFreeAgencyState(leagueId)]);}
 function save(leagueId,state,actor,action,metadata,files=[]){repository.commitLeagueFiles({leagueId,files:[...files,{name:'offseason.json',value:state},{name:'audit-log.json',value:[...repository.loadAuditLog(leagueId),{action,seasonId:repository.loadLeague(leagueId).seasonId,userId:actor.id,timestamp:new Date(now()).toISOString(),metadata}]}]});}
 function windowAction(leagueId,actor,{action,hours=24}){
  const {state,season}=context(leagueId,actor);if(season.step!=='CUTDOWN'||season.receipts?.CUTDOWN)throw Error('Roster cutdowns are not open.');
  if(!Number.isFinite(hours)||hours<=0||hours>168)throw Error('Choose an extension of up to seven days.');
  if(action==='open'){if(season.cutdowns)return inspect(leagueId);season.cutdowns={status:'OPEN',openedAt:new Date(now()).toISOString(),deadlineAt:new Date(now()+24*HOUR).toISOString(),reminders:[],waivers:[]};}
  else if(action==='extend'){if(!season.cutdowns)throw Error('Open the cutdown period first.');season.cutdowns.deadlineAt=new Date(Math.max(now(),Date.parse(season.cutdowns.deadlineAt))+hours*HOUR).toISOString();season.cutdowns.reminders=[];}
  else throw Error('Choose open or extend.');
  season.revision++;delete season.pending;delete season.staffCompletion;save(leagueId,state,actor,'offseason.cutdown.'+action,{deadlineAt:season.cutdowns.deadlineAt});return inspect(leagueId);
 }
 function prepareWaiver(leagueId,actor,playerId){
  const {c,state,season}=context(leagueId,actor,false);if(season.step!=='CUTDOWN'||season.receipts?.CUTDOWN||season.cutdowns?.status!=='OPEN')throw Error('Open the cutdown period first.');
  const memberships=activeMemberships(repository.loadRosterMemberships(leagueId),c.seasonId),member=memberships.find(m=>m.playerId===playerId),player=repository.loadPlayers(leagueId).find(p=>p.playerId===playerId&&!p.retiredAt);if(!member||!player)throw Error('Choose an active roster player.');
  const commissioner=actor.authorized&&actor.id===c.league.commissionerUserId;const owners=repository.loadOwners(leagueId).filter(o=>o.teamId===member.teamId);
  if(!commissioner&&(owners.length!==1||owners[0].userId!==actor.id))throw Error('Only the assigned coach can waive this team’s players.');
  if(Number(player.overall)>=85)throw Error('Players rated 85+ OVR cannot be waived, including by the commissioner.');
  if(memberships.filter(m=>m.teamId===member.teamId).length<=15)throw Error('Cutdown waivers cannot reduce a roster below 15.');
  const lock=playerTransactionLock(repository,leagueId,c.seasonId,playerId);if(lock)throw Error(lock);
  const token=randomUUID();season.cutdowns.pending ||= {};season.cutdowns.pending[token]={actorId:actor.id,playerId,teamId:member.teamId,expiresAt:now()+300000,sourceDigest:source(leagueId)};
  save(leagueId,state,actor,'offseason.cutdown.waiver.prepared',{token,playerId,teamId:member.teamId});return {token,playerId,playerName:player.name,teamId:member.teamId};
 }
 function confirmWaiver(leagueId,actor,token){
  const {c,state,season}=context(leagueId,actor,false),previous=season.cutdowns?.waivers?.find(w=>w.requestId===token);if(previous){if(previous.userId!==actor.id)throw Error('Confirmation belongs to another coach.');return previous;}
  const p=season.cutdowns?.pending?.[token];if(season.step!=='CUTDOWN'||season.receipts?.CUTDOWN||!p||p.actorId!==actor.id||p.expiresAt<=now()||p.sourceDigest!==source(leagueId))throw Error('Waiver confirmation expired or changed. Review again.');
  const members=repository.loadRosterMemberships(leagueId),players=repository.loadPlayers(leagueId),player=players.find(player=>player.playerId===p.playerId),at=new Date(now()).toISOString();
  if(Number(player?.overall)>=85)throw Error('Players rated 85+ OVR cannot be waived.');
  for(const m of activeMemberships(members,c.seasonId).filter(m=>m.playerId===p.playerId)){m.active=false;m.endedAt=at;m.endedReason='OFFSEASON_CUTDOWN';}
  player.contractHistory=[...(player.contractHistory||[]),{at,teamId:p.teamId,reason:'OFFSEASON_CUTDOWN',contract:player.contract||null}];player.teamId=null;player.lastTeamId=p.teamId;delete player.contract;
  const receipt={requestId:token,playerId:p.playerId,teamId:p.teamId,userId:actor.id,at};season.cutdowns.waivers.push(receipt);delete season.cutdowns.pending[token];season.revision++;delete season.pending;delete season.staffCompletion;backup();save(leagueId,state,actor,'offseason.cutdown.waived',receipt,[{name:'players.json',value:players},{name:'roster-memberships.json',value:members}]);return receipt;
 }
 function prepareCompletion(leagueId,actor){const {state,season}=context(leagueId,actor),view=inspect(leagueId);if(view.receipt)return view;if(!view.ready) return view;if(season.step==='CUTDOWN'&&!season.cutdowns)throw Error('Open the cutdown period before closing it.');
  const pending={token:randomUUID(),actorId:actor.id,step:season.step,expiresAt:now()+300000,sourceDigest:source(leagueId)};season.staffCompletion=pending;save(leagueId,state,actor,'offseason.'+season.step.toLowerCase()+'.completion.prepared',{token:pending.token});return {...view,token:pending.token};}
 function confirmCompletion(leagueId,actor,token){const {state,season}=context(leagueId,actor);if(season.receipts?.[season.step]?.requestId===token)return season.receipts[season.step];const p=season.staffCompletion;if(!p||p.token!==token||p.actorId!==actor.id||p.step!==season.step||p.expiresAt<=now()||p.sourceDigest!==source(leagueId)||!inspect(leagueId).ready)throw Error('Completion review expired or changed. Review again.');
  const receipt={requestId:token,confirmedBy:actor.id,confirmedAt:new Date(now()).toISOString()};season.receipts ||= {};season.receipts[season.step]=receipt;if(season.step==='CUTDOWN')season.cutdowns.status='COMPLETED';season.revision++;delete season.staffCompletion;delete season.pending;backup();save(leagueId,state,actor,'offseason.'+season.step.toLowerCase()+'.completed',receipt);return receipt;}
 return {inspect,windowAction,prepareWaiver,confirmWaiver,prepareCompletion,confirmCompletion};
}
module.exports={createOffseasonRosterService};
