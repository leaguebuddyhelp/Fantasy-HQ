const fs = require('fs');
const path = require('path');
const {randomUUID, createHash} = require('crypto');
const {requireCommissioner} = require('./postseason-state');
const previews = new Map(), running = new Set();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Explicit commissioner action only. Historical proofs and completed transactions are retained.
function createFreeAgencyRetirement({repository, backup = () => require('./storage-safety').createStorageBackup(repository.dataRoot,{label:'before-retiring-free-agency'})}) {
 function source(leagueId) { return [repository.loadLeague(leagueId).league,repository.loadSettings(leagueId),repository.loadFreeAgencyState(leagueId),repository.loadOffseason(leagueId)]; }
 function authorize(leagueId,actor,guild) {requireCommissioner(repository.loadLeague(leagueId),actor);if(repository.loadGuildLeagueBinding(guild.id)?.leagueId!==leagueId)throw Error('Guild does not belong to this league.');}
 async function candidates(leagueId,guild) {
  const settings=repository.loadSettings(leagueId),ids=settings.discordChannels||{},out=[];
  for(const key of ['freeAgency','freeAgencyProof']) {
   const id=ids[key];if(!id||out.some(c=>c.id===id))continue;
   if(Object.entries(ids).some(([k,v])=>!['freeAgency','freeAgencyProof'].includes(k)&&v===id))continue; // Never delete shared Staff or trade channels.
   let channel;try{channel=await guild.channels.fetch(id);}catch(e){if(Number(e.code)!==10003)throw e;}
   if(channel&&!/free[-_ ]?agency|fa[-_ ]?proof/i.test(channel.name))throw Error('The saved free-agency channel was renamed; review it before removing it.');
   out.push({id,key,name:channel?.name||null});
  }
  return out;
 }
 async function prepare(leagueId,actor,guild) {
  authorize(leagueId,actor,guild);const channels=await candidates(leagueId,guild),token=randomUUID();
  previews.set(token,{leagueId,actorId:actor.id,guildId:guild.id,root:repository.dataRoot,source:hash(source(leagueId)),channels,expiresAt:Date.now()+300000});
  return {token,channels,preserves:['Completed transactions','Roster memberships','Proof originals','Shared Staff channel']};
 }
 async function confirm(leagueId,actor,guild,token) {
  authorize(leagueId,actor,guild);const p=previews.get(token),key=repository.dataRoot+':'+leagueId;
  if(!p||p.leagueId!==leagueId||p.actorId!==actor.id||p.guildId!==guild.id||p.root!==repository.dataRoot||p.expiresAt<=Date.now()||p.source!==hash(source(leagueId)))throw Error('Retirement preview expired or changed. Review again.');
  if(running.has(key))throw Error('Free agency cleanup is already running.');running.add(key);
  try {
   const safety=backup(),at=new Date().toISOString(),context=repository.loadLeague(leagueId),dir=path.join(context.paths.leagueRoot,'retired-free-agency');fs.mkdirSync(dir,{recursive:true});
   const state=repository.loadFreeAgencyState(leagueId);
   require('./simulation-storage').atomic(path.join(dir,token+'.json'),{at,actorId:actor.id,backupId:safety?.id,state,offseason:repository.loadOffseason(leagueId),channels:p.channels});
   const active=new Set(['OPEN','CLOSED_AWAITING_REVIEW','RESOLVING','AWAITING_WINNER_ROSTER_CUT','PENDING_REVIEW','APPROVED','PENDING','ACTIVE','AWAITING_STAFF','PAUSED']);
   for(const rows of [state.windows,state.offers,state.waivers,state.drafts,...Object.values(state.offseason||{}).flatMap(m=>[m.stages||[],m.offers||[],m.drafts||[]])])for(const row of rows||[])if(active.has(row.status)){row.retiredStatus=row.status;row.status='CANCELLED';row.retiredAt=at;}
   state.retirement={at,actorId:actor.id,requestId:token,backupId:safety?.id};
   repository.commitLeagueFiles({leagueId,files:[{name:'free-agency.json',value:state},{name:'audit-log.json',value:[...repository.loadAuditLog(leagueId),{action:'free-agency.retired',userId:actor.id,timestamp:at,metadata:state.retirement}]}]});
   const deleted=[];
   for(const saved of p.channels) {
    let channel;try{channel=await guild.channels.fetch(saved.id);}catch(e){if(Number(e.code)!==10003)throw e;}
    if(!channel)continue;
    // Recheck ownership and name before an irreversible Discord deletion.
    if(!(await candidates(leagueId,guild)).some(c=>c.id===saved.id&&c.name===saved.name))throw Error('Channel ownership changed during cleanup.');
    if(channel.threads){const activeThreads=await channel.threads.fetchActive(),archived=await channel.threads.fetchArchived({limit:2});if(activeThreads.threads.size||archived.threads.size)throw Error('Free-agency channel contains threads. Archive those threads before deleting this channel.');}
    const messages=[];let before;
    for(;;){const page=await channel.messages.fetch({limit:100,...(before?{before}:{})});if(!page.size)break;messages.push(...page.values());before=[...page.values()].at(-1).id;if(page.size<100)break;}
    require('./simulation-storage').atomic(path.join(dir,'channel-'+saved.id+'.json'),{channel:{id:saved.id,name:saved.name,topic:channel.topic},archivedAt:at,messages:messages.map(m=>m.toJSON())});
    await channel.delete('Commissioner requested retirement of duplicate free-agency workflow; transcript archived.');deleted.push(saved.id);
   }
   const clearedControls=[],botId=guild.client?.user?.id,seenProofs=new Set();
   if(botId)for(const offer of [...(state.offers||[]),...(state.waivers||[])]) {
    const channelId=offer.proofChannelId,messageId=offer.proofMessageId,proofKey=channelId+':'+messageId;
    if(!channelId||!messageId||seenProofs.has(proofKey)||p.channels.some(c=>c.id===channelId))continue;seenProofs.add(proofKey);
    let channel,message;try{channel=await guild.channels.fetch(channelId);message=await channel?.messages?.fetch(messageId);}catch(e){if(![10003,10008].includes(Number(e.code)))throw e;}
    if(message?.author?.id!==botId||!message.components?.length)continue;
    require('./simulation-storage').atomic(path.join(dir,'controls-'+channelId+'-'+messageId+'.json'),{archivedAt:at,message:message.toJSON()});
    await message.edit({components:[],allowedMentions:{parse:[]}});clearedControls.push(proofKey);
   }
   const settings=repository.loadSettings(leagueId);settings.discordChannels={...settings.discordChannels};delete settings.discordChannels.freeAgency;delete settings.discordChannels.freeAgencyProof;
   settings.discordPins={...settings.discordPins};for(const k of Object.keys(settings.discordPins))if(/^freeAgency/.test(k))delete settings.discordPins[k];delete settings.freeAgencyTestWindowSeconds;
   settings.freeAgencyRetirement={...state.retirement,deletedChannelIds:deleted,clearedControlMessageIds:clearedControls};repository.saveSettings(leagueId,settings);previews.delete(token);
   return {retired:true,deletedChannelIds:deleted,clearedControlMessageIds:clearedControls,backupId:safety?.id,archive:dir};
  } finally {running.delete(key);}
 }
 return {prepare,confirm};
}
module.exports={createFreeAgencyRetirement};
