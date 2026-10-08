const {ChannelType,PermissionFlagsBits,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle} = require('discord.js');
const {requireLeagueStaff} = require('./discord-permissions');
const {createPostseasonService} = require('./postseason-service');
const {gamePayload} = require('./discord-game-submissions');
const queues = new Map(), publishing = new Map();
const button = (id,label,style=ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
function statusPayload(state) {
  if(state.champion)return {embeds:[new EmbedBuilder().setColor(0xffdc21).setTitle('🏆 POSTSEASON COMPLETE').setDescription(`Champion: ${Object.values(state.seeds).flat().find(t=>t.teamId===state.champion.teamId)?.teamName||state.champion.teamId}\nSeason ${state.seasonNumber||state.seasonId} · League is in OFFSEASON.${state.conflicts?.length?'\n⚠️ '+state.conflicts.map(c=>c.reason).join('\n'):''}`)],components:state.champion.announcementMessageId?[]:[new ActionRowBuilder().addComponents(button('post:champion-publish','Retry Championship Announcement'))],allowedMentions:{parse:[]}};
  const current = state.series.filter(s=>s.stage===state.stage);
  const label = id => Object.values(state.seeds).flat().find(t=>t.teamId===id)?.teamName || id;
  const round=state.rounds.at(-1);
  return {embeds:[new EmbedBuilder().setColor(0xffdc21).setTitle(`${state.roundComplete ? 'ROUND COMPLETE' : 'POSTSEASON'} · ${state.stage.replaceAll('_',' ')}`)
    .setDescription(`Deadline: <t:${Math.floor(Date.parse(round.deadlineAt)/1000)}:F>\n\n${current.map(s=>`**${label(s.team1Id)} vs ${label(s.team2Id)}** · ${s.wins[s.team1Id]}–${s.wins[s.team2Id]}${s.winnerTeamId?' · Winner: '+label(s.winnerTeamId):''}`).join('\n')}\n\n${state.conflicts.length ? '⚠️ '+state.conflicts.map(c=>c.reason).join('\n') : state.roundComplete ? 'Commissioner confirmation is required to continue.' : 'Only the next game in each series is open.'}`)],
    components:[new ActionRowBuilder().addComponents(button('post:refresh','Refresh / Repair Threads'),button('post:advance','Review Next Round',ButtonStyle.Primary),button('post:extend','Extend Deadline')),
      ...(state.stage==='PLAY_IN'?[new ActionRowBuilder().addComponents(button('post:final:East','Create East Final Play-In'),button('post:final:West','Create West Final Play-In'))]:[]),
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('post:series').setPlaceholder('Manage a matchup').addOptions(current.map(s=>({label:`${label(s.team1Id)} vs ${label(s.team2Id)}`.slice(0,100),value:s.id,description:`${s.wins[s.team1Id]}–${s.wins[s.team2Id]} · ${s.status}`}))))],allowedMentions:{parse:[]}};
}
function modal(id,title,fields) {
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(fields.map(([key,label])=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true))));
}
function createDiscordPostseason({submissions,syncOwners=guild=>require('./role-ownership').roleOwnership.sync(guild)}) {
  const repository=submissions.repository,service=createPostseasonService({repository,submissions});
  function actor(i) {requireLeagueStaff(i);return {id:i.user.id,authorized:true,staffAuthorized:true};}
  function binding(i) {return repository.loadLeagueContext({guildId:i.guildId});}
  async function refreshPin(guild) {
    const c=repository.loadLeagueContext({guildId:guild.id}), state=c.league.currentPhase==='OFFSEASON'?repository.loadPlayoffs(c.league.leagueId):service.inspect(c.league.leagueId),settings=repository.loadSettings(c.league.leagueId);
    const channel=await guild.channels.fetch(settings.discordChannels?.staff || settings.channelIds?.staff);
    if (!channel) throw Error('Configure the Staff channel through league setup.');
    if(!state)throw Error('No postseason to display.');
    if(state.champion){let changed=false;for(const series of state.series.filter(s=>s.discordThreadId&&!s.threadCleanedAt)){const thread=await guild.channels.fetch(series.discordThreadId);if(thread){if(thread.type!==ChannelType.PrivateThread||thread.guildId!==guild.id)throw Error('Completed series thread failed cleanup validation.');await thread.setArchived(true,'Completed postseason');}series.threadCleanedAt=new Date().toISOString();changed=true;}if(changed)repository.commitPostseason({leagueId:c.league.leagueId,playoffs:state,auditEntry:{action:'playoffs.completed-threads.archived',timestamp:new Date().toISOString()}});}
    const payload=statusPayload(state);let message;
    if (settings.postseasonMessageId) try {message=await channel.messages.fetch(settings.postseasonMessageId);} catch(error) {if(Number(error.code)!==10008)throw error;}
    if(message)await message.edit(payload);else {message=await channel.send(payload);await message.pin();repository.saveSettings(c.league.leagueId,{...settings,postseasonMessageId:message.id});}
    return message;
  }
  function createThreads(guild) {
    const key=`${repository.dataRoot}:${guild.id}`;
    if(queues.has(key))return queues.get(key);
    const run=(async()=>{
      const c=repository.loadLeagueContext({guildId:guild.id}),leagueId=c.league.leagueId,settings=repository.loadSettings(leagueId),parent=await guild.channels.fetch(settings.gamesChannelId || settings.discordChannels?.games || settings.channelIds?.games);
      if (!parent || parent.type!==ChannelType.GuildText || parent.guildId!==guild.id)throw Error('Configure the existing Games text channel.');
      if (!parent.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.CreatePrivateThreads,PermissionFlagsBits.SendMessagesInThreads,PermissionFlagsBits.ViewChannel]))throw Error('Bot requires private-thread permissions in Games.');
      const synced=await syncOwners(guild),owners=repository.loadOwners(leagueId),a={id:c.league.commissionerUserId,authorized:true};
      const state=service.inspect(leagueId);if(state.conflicts.length)throw Error('Resolve postseason correction conflicts before creating games.');
      for(const old of state.series.filter(s=>s.stage!==state.stage&&s.winnerTeamId&&s.discordThreadId&&!s.threadCleanedAt)){const channel=await guild.channels.fetch(old.discordThreadId);if(channel){if(channel.type!==ChannelType.PrivateThread||channel.guildId!==guild.id)throw Error('Completed series thread failed cleanup validation.');await channel.setArchived(true,'Completed postseason round');}service.updateThread(leagueId,old.id,a,{threadCleanedAt:new Date().toISOString()});}
      if(state.conflicts.length)throw Error('Resolve postseason correction conflicts before creating games.');
      for (const series of state.series.filter(s=>s.stage===state.stage&&!s.winnerTeamId)) {
        let thread=series.discordThreadId ? await guild.channels.fetch(series.discordThreadId) : null;
        if (thread && (thread.type!==ChannelType.PrivateThread || thread.guildId!==guild.id))throw Error('Saved series thread is invalid.');
        if (!thread) {
          if(series.threadCreationPending)throw Error(`Thread creation for ${series.id} was interrupted. Reconcile the existing Discord thread before retrying.`);
          service.updateThread(leagueId,series.id,a,{threadCreationPending:true});
          try {thread=await parent.threads.create({name:`${series.conference} · ${state.stage.replaceAll('_',' ')} · ${c.teams.find(t=>t.teamId===series.team1Id).teamName} vs ${c.teams.find(t=>t.teamId===series.team2Id).teamName}`.slice(0,100),type:ChannelType.PrivateThread,invitable:false,autoArchiveDuration:1440,reason:`LEAGUEbuddy postseason ${series.id}`});}
          catch(error) {if(!['ETIMEDOUT','ECONNRESET','UND_ERR_CONNECT_TIMEOUT'].includes(error.code)&&error.name!=='AbortError'&&!(error.status>=500))service.updateThread(leagueId,series.id,a,{threadCreationPending:false});throw error;}
          service.updateThread(leagueId,series.id,a,{threadCreationPending:false,discordThreadId:thread.id});
        }
        const coaches=[...new Set([series.team1Id,series.team2Id].flatMap(id=>synced.teamMemberIds?.[id]||owners.filter(o=>o.teamId===id).map(o=>o.userId)))];
        if(thread.archived)await thread.setArchived(false);
        for(const id of [...coaches,...(synced.staffUserIds||[])])await thread.members.add(id);
        const record=submissions.ensurePostseasonGame({leagueId,seriesId:series.id,guildId:guild.id,discordThreadId:thread.id});
        await submissions.mutate(record.game.gameId,r=>Object.assign(r.game,{discordThreadId:thread.id,coachUserIds:coaches,staffUserIds:synced.staffUserIds||[],staffRoleIds:synced.staffRoleIds||[],teamRoleIds:[series.team1Id,series.team2Id].map(id=>synced.teamRoleIds?.[id]).filter(Boolean)}));
        const game=submissions.load(record.game.gameId).game;let message;
        if(game.discordMessageId)try{message=await thread.messages.fetch(game.discordMessageId);}catch(error){if(Number(error.code)!==10008)throw error;}
        if(message)await message.edit(gamePayload(game));else{message=await thread.send({...gamePayload(game),allowedMentions:{parse:[],users:coaches,roles:game.staffRoleIds}});await submissions.setMessage(game.gameId,message.id);}
      }
      await refreshPin(guild);
    })().finally(()=>queues.delete(key));queues.set(key,run);return run;
  }
  async function handle(i) {
    try {
      const a=actor(i),c=binding(i),leagueId=c.league.leagueId,[,action,arg,extra]=i.customId.split(':');
      if(action==='start'){await i.deferReply({flags:64});const view=require('./season-transition').createSeasonTransitionService({submissions}).prepare(i.guildId,a);await i.editReply(require('./discord-week').playoffPayload(view));return;}
      if(action==='link'&&!i.isModalSubmit()){await i.showModal(modal(`post:link-save:${arg}`,'Recover existing series thread',[['thread','Existing private thread ID']]));return;}
      if(action==='extend'&&!i.isModalSubmit()) {await i.showModal(modal('post:extend-save','Extend postseason deadline',[['hours','Additional hours'],['reason','Reason']]));return;}
      if(action==='forfeit'&&!i.isModalSubmit()) {await i.showModal(modal(`post:forfeit-save:${arg}`,'Award series forfeit',[['winner','Winning team ID'],['reason','Reason']]));return;}
      await i.deferReply({flags:64});
      if(action==='link-save'){const seriesId=decodeURIComponent(arg),state=service.inspect(leagueId),series=state.series.find(s=>s.id===seriesId&&s.stage===state.stage);if(!series||series.winnerTeamId)throw Error('Choose an active series.');const thread=await i.guild.channels.fetch(i.fields.getTextInputValue('thread').trim()),settings=repository.loadSettings(leagueId),parentId=settings.gamesChannelId||settings.discordChannels?.games||settings.channelIds?.games;if(!thread||thread.type!==ChannelType.PrivateThread||thread.guildId!==i.guildId||thread.parentId!==parentId||state.series.some(s=>s.id!==seriesId&&s.discordThreadId===thread.id))throw Error('Choose an unused private thread in this league Games channel.');service.updateThread(leagueId,seriesId,a,{discordThreadId:thread.id,threadCreationPending:false});}
      else if(action==='extend-save')service.extendDeadline(leagueId,a,Number(i.fields.getTextInputValue('hours')),i.fields.getTextInputValue('reason'));
      else if(action==='final')service.createFinalPlayIn(leagueId,arg,a);
      else if(action==='series') {const s=service.inspect(leagueId).series.find(s=>s.id===i.values[0]);await i.editReply({content:`${s.team1Id} vs ${s.team2Id} · ${s.status}`,components:[new ActionRowBuilder().addComponents(button(`post:forfeit:${encodeURIComponent(s.id)}`,'Award Entire Series Forfeit',ButtonStyle.Danger),button(`post:link:${encodeURIComponent(s.id)}`,'Link Existing Series Thread'))]});return;}
      else if(action==='forfeit-save') {const p=service.prepareSeriesForfeit(leagueId,a,decodeURIComponent(arg),i.fields.getTextInputValue('winner'),i.fields.getTextInputValue('reason'));await i.editReply({content:`Confirm series forfeit to ${p.winnerTeamId}? ${p.reason}`,components:[new ActionRowBuilder().addComponents(button(`post:forfeit-confirm:${p.token}`,'Confirm Series Forfeit',ButtonStyle.Danger))]});return;}
      else if(action==='forfeit-confirm')service.confirmSeriesForfeit(leagueId,a,arg);
      else if(action==='game-forfeit') {const p=service.prepareGameForfeit(leagueId,a,arg,extra,'Staff-confirmed postseason game forfeit');await i.editReply({content:`Award this game to ${p.winnerTeamId}? No player statistics will be recorded.`,components:[new ActionRowBuilder().addComponents(button(`post:game-forfeit-confirm:${p.token}`,'Confirm Game Forfeit',ButtonStyle.Danger))]});return;}
      else if(action==='game-forfeit-confirm')await service.confirmGameForfeit(leagueId,a,arg);
      else if(action==='advance'&&service.inspect(leagueId).stage==='NBA_FINALS'){const p=service.prepareChampionship(leagueId,a);await i.editReply({content:'Confirm the league champion and transition to Offseason?',components:[new ActionRowBuilder().addComponents(button('post:champion-confirm:'+p.token,'Finalize Championship',ButtonStyle.Success))]});return;}
      else if(action==='champion-confirm'){const state=service.finalizeChampionship(leagueId,a,arg);await publishChampion(i.guild,leagueId,state);await refreshPin(i.guild);await i.editReply('Championship finalized. League is now in OFFSEASON.');return;}
      else if(action==='champion-publish'){const state=repository.loadPlayoffs(leagueId);if(!state?.champion)throw Error('No finalized championship.');await publishChampion(i.guild,leagueId,state);await refreshPin(i.guild);await i.editReply('Championship announcement published.');return;}
      else if(action==='advance') {const p=service.prepareAdvance(leagueId,a);await i.editReply({content:`Advance to ${p.nextMatchups[0].stage.replaceAll('_',' ')}?\n${p.nextMatchups.map(s=>s.team1Id+' vs '+s.team2Id).join('\n')}`,components:[new ActionRowBuilder().addComponents(button(`post:advance-confirm:${p.token}`,'Confirm Advance Round',ButtonStyle.Primary))]});return;}
      else if(action==='advance-confirm') {service.advance(leagueId,a,arg);}
      else if(action!=='refresh')throw Error('Unknown postseason control.');
      await createThreads(i.guild);await i.editReply(statusPayload(service.inspect(leagueId)));
    }catch(error){if(i.deferred||i.replied)await i.editReply({content:error.message,components:[],embeds:[]});else await i.reply({content:error.message,flags:64});}
  }
  function publishChampion(guild,leagueId,state){const key=repository.dataRoot+':'+leagueId+':'+state.seasonId;if(publishing.has(key))return publishing.get(key);const task=publishChampionOnce(guild,leagueId,state).finally(()=>publishing.delete(key));publishing.set(key,task);return task;}
  async function publishChampionOnce(guild,leagueId,state) {
    state=repository.loadPlayoffs(leagueId,state.seasonId);if(!state?.champion)throw Error('No finalized championship.');if(state.champion.announcementMessageId)return;
    const channel=await guild.channels.fetch(repository.loadSettings(leagueId).discordChannels?.announcements);
    if(!channel)throw Error('Configure Announcements; championship saved and announcement needs retry.');
    const c=repository.loadLeague(leagueId),label=id=>c.teams.find(t=>t.teamId===id)?.teamName||id;
    const champ=state.champion;
    const message=await channel.send({embeds:[new EmbedBuilder().setColor(0xffdc21).setTitle('🏆 LEAGUE CHAMPION · Season '+(state.seasonNumber||state.seasonId)).setDescription(`${label(champ.teamId)}${champ.coachUserId?' · <@'+champ.coachUserId+'>':''}\nRunner-up: ${label(champ.runnerUpTeamId)}\nFinals: ${Object.values(champ.seriesScore).join('–')}\nFinals MVP: ${repository.loadPlayers(leagueId).find(p=>p.playerId===champ.finalsMvpPlayerId)?.name||champ.finalsMvpPlayerId}`)],allowedMentions:{parse:[],users:champ.coachUserId?[champ.coachUserId]:[]},nonce:require('crypto').createHash('sha256').update('champion:'+leagueId+':'+state.seasonId).digest('hex').slice(0,24),enforceNonce:true});
    state.champion.announcementMessageId=message.id;repository.commitPostseason({leagueId,playoffs:state,auditEntry:{action:'championship.announced',timestamp:new Date().toISOString(),metadata:{messageId:message.id}}});
  }
  return {service,handle,createThreads,refreshPin,publishChampion};
}
module.exports={createDiscordPostseason,statusPayload};
