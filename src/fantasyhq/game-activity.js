const {ChannelType,EmbedBuilder}=require('discord.js');
const HOUR=3600000;
function activityView(record,now=Date.now()) {
 const game=record.game,latest=record.submissions.at(-1);
 const media=record.media.filter(m=>m.submissionId===latest?.submissionId);
 const complete=game.status==='FINAL'||!!game.finalizedAt;
 const submitted=!!latest && !['COLLECTING','CANCELLED'].includes(latest.status)&&media.length===2;
 const teams=[game.team1Id,game.team2Id].map((teamId,i)=>({teamId,name:i?game.team2Name:game.team1Name,...(game.activity?.teams?.[teamId] || {participated:false,count:0,lastActivityAt:null})}));
 const pastDeadline=Number.isFinite(Date.parse(game.deadlineAt))&&now>=Date.parse(game.deadlineAt)&&!complete;
 const status=complete?'COMPLETE':submitted?'GAME SUBMITTED':pastDeadline?'PAST DEADLINE':teams.every(t=>t.participated)?'ACTIVE':teams[0].participated?'WAITING ON TEAM B':teams[1].participated?'WAITING ON TEAM A':'NO ACTIVITY';
 return {status,complete,submitted,pastDeadline,teams,submissionStatus:latest?.status || 'NOT SUBMITTED',screenshots:media.length,startedAt:game.startedAt || null,deadlineAt:game.deadlineAt,threadCreatedAt:game.threadCreatedAt || null,lastActivityAt:game.activity?.lastActivityAt || null,lastActivityUserId:game.activity?.lastActivityUserId || null,count:game.activity?.count || 0};
}
function activityLines(view){return view.teams.map(t=>`**${t.name}:** ${t.participated?`Active <t:${Math.floor(Date.parse(t.lastActivityAt)/1000)}:R>`:'No activity yet ⚠'}`).join('\n');}
function createGameActivityService({submissions=require('./game-submissions').createGameSubmissionService(),now=()=>Date.now(),logger=console}={}){
 let running;
 const approvals = require("./discord-game-approvals").createDiscordGameApprovals({ submissions });
 async function recordActivity({guildId,threadId,userId,bot=false,privateThread,eventId}){
  if(bot||!privateThread)return false;
  const record=submissions.findThread(guildId,threadId);if(!record)return false;
  return submissions.mutate(record.game.gameId,r=>{
   if(activityView(r,now()).complete)return false;
   const owners=submissions.repository.loadOwners(r.game.leagueId).filter(o=>o.userId===userId&&[r.game.team1Id,r.game.team2Id].includes(o.teamId));
   if(owners.length!==1)return false;
   const activity=r.game.activity ||= {count:0,teams:{}};
   if(eventId&&activity.lastEventId===eventId)return false;
   const at=new Date(now()).toISOString(),team=activity.teams[owners[0].teamId] ||= {count:0};
   Object.assign(team,{participated:true,count:team.count+1,lastActivityAt:at,lastActivityUserId:userId});
   Object.assign(activity,{count:activity.count+1,lastActivityAt:at,lastActivityUserId:userId,lastEventId:eventId || null});return true;
  });
 }
 async function refresh(channel,record,force=false){
  if(!record.game.discordMessageId)return;
  const view=activityView(record,now()),signature=JSON.stringify(["approved-game-v4",record.game.testMode,record.game.matchupType,record.game.inGameDate,view.status,view.submissionStatus,view.screenshots,view.pastDeadline,view.teams.map(t=>t.participated)]);
  const card=record.game.activityCard;
  if(!force&&card?.signature===signature)return;
  try{
   const message=await channel.messages.fetch(record.game.discordMessageId);
   const payload=require('./discord-game-submissions').gamePayload(record.game,view);
   await message.edit(payload);
   await submissions.mutate(record.game.gameId,r=>{r.game.activityCard={signature,updatedAt:new Date(now()).toISOString()};});
  }catch(error){logger.error('Game activity card:',error.message);}
 }
 async function message(message){
  const changed=await recordActivity({guildId:message.guildId,threadId:message.channelId,userId:message.author.id,bot:message.author.bot,privateThread:message.channel?.type===ChannelType.PrivateThread,eventId:message.id});
  if(changed){const r=submissions.findThread(message.guildId,message.channelId);await refresh(message.channel,r,now()-Date.parse(r.game.activityCard?.updatedAt || 0)>15*60*1000);}
 }
 async function button(interaction){
  const gameId=interaction.customId.split(':')[1],record=submissions.findThread(interaction.guildId,interaction.channelId);
  if(record?.game.gameId!==gameId)return;
  await recordActivity({guildId:interaction.guildId,threadId:interaction.channelId,userId:interaction.user.id,bot:interaction.user.bot,privateThread:interaction.channel?.type===ChannelType.PrivateThread,eventId:interaction.id});
  await refresh(interaction.channel,submissions.load(gameId));
 }
 function tick(client){if(running)return running;running=run(client).finally(()=>running=null);return running;}
 async function run(client){for(const saved of submissions.records()){
  const game=saved.game;if(!game.discordThreadId || game.discordThreadCleanedAt)continue;
  try{
   if (game.status === 'FINAL' && game.finalizedAt && game.result?.scores) {
    const guild = await client.guilds.fetch(game.guildId), channel = await guild.channels.fetch(game.discordThreadId);
    if (channel?.type === ChannelType.PrivateThread) { await approvals.publish(channel, game.gameId); await refresh(channel, submissions.load(game.gameId)); }
    continue;
   }
   const schedule=submissions.repository.loadSchedule(game.leagueId,game.seasonId),week=schedule.weeks.find(w=>w.weekId===game.weekId);
   if(week?.status!=='ACTIVE')continue;
   const deadline=Date.parse(week.deadlineAt);if(!Number.isFinite(deadline))continue;
   if(game.deadlineAt!==week.deadlineAt || game.startedAt!==week.startedAt)await submissions.mutate(game.gameId,r=>{r.game.startedAt=week.startedAt;r.game.deadlineAt=week.deadlineAt;});
   const matchup = require("./game-decisions").cpuState(submissions.repository, game);
   if (game.testMode !== matchup.testMode || game.matchupType !== matchup.matchupType || JSON.stringify(game.cpuTeamIds) !== JSON.stringify(matchup.cpuTeamIds)) await submissions.mutate(game.gameId, r => Object.assign(r.game, matchup));
   const record=submissions.load(game.gameId),view=activityView(record,now());
   const guild=await client.guilds.fetch(game.guildId),channel=await guild.channels.fetch(game.discordThreadId);
   if(!channel||channel.type!==ChannelType.PrivateThread)continue;
   await refresh(channel,record);
   if(view.complete)continue;
   const remaining=deadline-now();
   const stage=remaining<=0?'deadline':remaining<=6*HOUR?'6h':remaining<=24*HOUR?'24h':null;
   if(!stage || (stage!=='deadline'&&view.submitted) || (stage==='24h'&&view.teams.every(t=>t.participated)))continue;
   const claimed=await submissions.mutate(game.gameId,r=>{
    const current=activityView(r,now());if(current.complete||(stage!=='deadline'&&current.submitted))return false;
    r.game.activityReminders ||= {};if(r.game.activityReminders[stage])return false;
    r.game.activityReminders[stage]={claimedAt:new Date(now()).toISOString()};return true;
   });if(!claimed)continue;
   try{
    const current=activityView(submissions.load(game.gameId),now());if(current.complete||(stage!=='deadline'&&current.submitted))continue;
    const owners=submissions.repository.loadOwners(game.leagueId);
    const ids=stage==='deadline'?[]:current.teams.filter(t=>stage==='6h'||!t.participated).map(t=>owners.find(o=>o.teamId===t.teamId)?.userId).filter(Boolean);
    const embed=new EmbedBuilder().setColor(0xffdc21).setTitle(stage==='deadline'?'DEADLINE REACHED':stage==='6h'?'6 HOURS REMAINING':'GAME REMINDER')
     .setDescription(`**Week ${game.weekNumber} · ${game.team1Name} vs ${game.team2Name}**\n\n${activityLines(current)}\n\nStatus: ${current.status}\nDeadline: <t:${Math.floor(deadline/1000)}:F> (<t:${Math.floor(deadline/1000)}:R>)\n\n${stage==='deadline'?'Commissioner review required.':ids.map(id=>`<@${id}>`).join(' ')+' Please coordinate your game.'}`);
    if(channel.archived)await channel.setArchived(false);
    await channel.send({embeds:[embed],allowedMentions:{parse:[],users:ids}});
    await submissions.mutate(game.gameId,r=>{r.game.activityReminders[stage].sentAt=new Date(now()).toISOString();});
   }catch(error){await submissions.mutate(game.gameId,r=>{r.game.activityReminders[stage].error=error.message;});logger.error('Game reminder:',error.message);}
  }catch(error){logger.error('Game activity:',error.message);}
 }}
 return {recordActivity,message,button,tick};
}
module.exports={activityView,activityLines,createGameActivityService};
