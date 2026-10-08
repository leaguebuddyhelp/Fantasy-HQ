const {EmbedBuilder}=require('discord.js');
const {createPowerRankingsService}=require('./power-rankings');
const running=new Map();
function rankingsPayload(snapshot){return {embeds:[new EmbedBuilder().setTitle('📊 LEAGUEbuddy POWER RANKINGS').setColor(0xffdc21).setDescription(snapshot.teams.slice(0,10).map(t=>{const movement=t.movement==null?'NEW':t.movement>0?'↑ '+t.movement:t.movement<0?'↓ '+Math.abs(t.movement):'—';return `**${t.rank}.** ${require('../shared/team-emojis').teamLabel(t.teamName)} · **${t.score.toFixed(1)}**\n${t.wins}-${t.losses} · ${movement}`;}).join('\n\n')).setFooter({text:`POWER_RANKINGS:${snapshot.seasonId}:${snapshot.key}`})],allowedMentions:{parse:[]}};}
function createDiscordPowerRankings({repository,submissions,now=Date.now}){
 const service=createPowerRankingsService({repository,submissions,now});
 function reconcile(guild,leagueId){const key=repository.dataRoot+':'+leagueId;if(running.has(key))return running.get(key);
  const task=(async()=>{let settings=repository.loadSettings(leagueId);if(settings.simulationId)return;const c=repository.loadLeague(leagueId),step=repository.loadOffseason(leagueId)?.seasons[c.seasonId]?.step,preseason=['PROGRESSION','PREPARATION'].includes(step)||c.league.currentPhase==='PRESEASON';service.process(leagueId,{preseason});const snapshot=service.list(leagueId).filter(s=>s.seasonId===c.seasonId||(s.preseason&&s.sourceSeasonId===c.seasonId)).at(-1);if(!snapshot)return;const channelId=settings.discordChannels?.powerRankings;if(!channelId)throw Error('Set up the Power Rankings channel.');const channel=await guild.channels.fetch(channelId),payload=rankingsPayload(snapshot),stored=settings.powerRankingsPin;
   if(stored?.key!==snapshot.key||stored?.seasonId!==snapshot.seasonId){let message;
    if(stored?.messageId){try{message=await channel.messages.fetch(stored.messageId);}catch(error){if(error.code!==10008)throw error;}if(message)await message.edit(payload);}
    if(!message){const receipt=snapshot.publication;await require('./discord-permanent-post').publishPermanentPost({key:key+':pin:'+snapshot.key,channel,marker:`POWER_RANKINGS:${snapshot.seasonId}:${snapshot.key}`,receipt,now,payload:async()=>payload,save:publication=>{const state=repository.loadPowerRankings(leagueId);state.seasons[snapshot.seasonId][snapshot.key].publication=publication;repository.commitLeagueFiles({leagueId,files:[{name:'power-rankings.json',value:state}]});}});const receiptNow=repository.loadPowerRankings(leagueId).seasons[snapshot.seasonId][snapshot.key].publication;message=await channel.messages.fetch(receiptNow.messageId);}
    if(!message.pinned)await message.pin();settings=repository.loadSettings(leagueId);repository.saveSettings(leagueId,{...settings,powerRankingsPin:{key:snapshot.key,seasonId:snapshot.seasonId,messageId:message.id}});
   }
   const owners=repository.loadOwners(leagueId),entries=snapshot.teams.filter(t=>t.enteredTop10),notify=entries.map(t=>({team:t,owner:owners.find(o=>o.teamId===t.teamId)?.userId})).filter(e=>e.owner);if(!notify.length)return;
   const current=repository.loadPowerRankings(leagueId).seasons[snapshot.seasonId][snapshot.key],marker=`POWER_RANKINGS_ENTRY:${leagueId}:${snapshot.seasonId}:${snapshot.key}`;
   await require('./discord-permanent-post').publishPermanentPost({key:key+':entries:'+snapshot.key,channel,marker,receipt:current.entryPublication,now,payload:async()=>({content:notify.map(e=>`<@${e.owner}> · ${e.team.teamName} enters the Top 10 at #${e.team.rank}.`).join('\n'),embeds:[new EmbedBuilder().setTitle('🏀 New Top 10 teams').setDescription('Rankings updated from the finalized league week or verified preseason progression.').setFooter({text:marker})],allowedMentions:{users:[...new Set(notify.map(e=>e.owner))],parse:[]}}),save:publication=>{const state=repository.loadPowerRankings(leagueId);state.seasons[snapshot.seasonId][snapshot.key].entryPublication=publication;repository.commitLeagueFiles({leagueId,files:[{name:'power-rankings.json',value:state}]});}});
  })().finally(()=>running.delete(key));running.set(key,task);return task;
 }
 return {service,reconcile};
}
module.exports={createDiscordPowerRankings,rankingsPayload};
