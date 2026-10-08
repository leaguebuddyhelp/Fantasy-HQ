const {EmbedBuilder}=require('discord.js');
const {publishPermanentPost}=require('./discord-permanent-post');
function createDiscordOffseasonReminders({repository,now=Date.now}){
 async function reconcile(guild,leagueId){
  const c=repository.loadLeague(leagueId),settings=repository.loadSettings(leagueId),season=repository.loadOffseason(leagueId)?.seasons[c.seasonId],window=season?.cutdowns;
  if(settings.simulationId||c.league.currentPhase!=='OFFSEASON'||season?.step!=='CUTDOWN'||window?.status!=='OPEN'||season.receipts?.CUTDOWN)return;
  const remaining=Date.parse(window.deadlineAt)-now();if(remaining<=0)return;const hours=remaining<=3600000?1:remaining<=6*3600000?6:null;if(!hours)return;
  const id=window.deadlineAt+':'+hours,receipt=window.reminders?.find(r=>r.id===id);if(receipt?.messageId)return;
  const view=require('./offseason-roster-service').createOffseasonRosterService({repository}).inspect(leagueId),teams=view.teams.filter(t=>t.count!==15),owners=repository.loadOwners(leagueId);if(!teams.length)return;
  const channelId=settings.discordChannels?.announcements;if(!channelId)throw Error('Set up announcements for cutdown reminders.');const channel=await guild.channels.fetch(channelId),users=[...new Set(teams.flatMap(t=>owners.filter(o=>o.teamId===t.teamId).map(o=>o.userId)))],marker=`CUTDOWN_REMINDER:${leagueId}:${c.seasonId}:${id}`;
  await publishPermanentPost({key:repository.dataRoot+':'+marker,channel,marker,receipt,now,payload:async()=>({content:users.map(id=>'<@'+id+'>').join(' '),allowedMentions:{users,parse:[]},embeds:[new EmbedBuilder().setTitle('✂️ Roster cutdowns · '+hours+' hour reminder').setColor(0xffdc21).setDescription(`Deadline: <t:${Math.floor(Date.parse(window.deadlineAt)/1000)}:F>\nUse **MyTeam → Roster Cutdown**. Rosters must finish at exactly 15 players; 85+ OVR players cannot be waived.\n\n`+teams.map(t=>`${t.teamName}: **${t.count}/15**`).join('\n')).setFooter({text:marker})]}),save:publication=>{const state=repository.loadOffseason(leagueId),current=state.seasons[c.seasonId].cutdowns;if(current.deadlineAt!==window.deadlineAt)throw Error('Cutdown deadline changed; review reminder delivery.');current.reminders ||= [];const i=current.reminders.findIndex(r=>r.id===id),record={id,hours,...publication};if(i>=0)current.reminders[i]=record;else current.reminders.push(record);repository.commitLeagueFiles({leagueId,files:[{name:'offseason.json',value:state}]});}});
 }
 return {reconcile};
}
module.exports={createDiscordOffseasonReminders};
