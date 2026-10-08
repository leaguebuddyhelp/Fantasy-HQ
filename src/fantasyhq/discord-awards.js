const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,StringSelectMenuBuilder,AttachmentBuilder}=require('discord.js');
const {createAwardsService,GROUPS,NAMES}=require('./awards-service');
const {requireLeagueStaff}=require('./discord-permissions');
const drafts=new Map(),publishing=new Map();
function hubPayload(){return {embeds:[new EmbedBuilder().setColor(0xffdc21).setTitle('🏆 SEASON AWARDS').setDescription('Staff enters the winners from NBA 2K. Review the entire batch before publication. Use an existing group to make an audited correction.')],components:[new ActionRowBuilder().addComponents(...Object.keys(GROUPS).map(group=>new ButtonBuilder().setCustomId('awards:start:'+group).setLabel(group.replaceAll('_',' ')).setStyle(ButtonStyle.Primary)))],allowedMentions:{parse:[]}};}
function createDiscordAwards({repository,submissions}){
  const service=createAwardsService({repository,submissions});
  function publish(guild,leagueId,record){
    const lock=`${repository.dataRoot}:${leagueId}:${record.seasonId}:${record.group}`;if(publishing.has(lock))return publishing.get(lock);
    const task=(async()=>{
      if(record.publication?.revision===record.revision)return;
      const settings=repository.loadSettings(leagueId),channel=await guild.channels.fetch(settings.discordChannels?.seasonAwards);if(!channel)throw Error('Configure Season Awards through league setup.');
      const files=[],embeds=record.winners.map(w=>{
        const card=require('../shared/discord-player-card').nbaPlayerCard({...w.player,teamName:w.teamName},`Season ${record.seasonNumber||record.seasonId}`),embed=new EmbedBuilder().setColor(0xffdc21).setTitle(`🏆 ${w.awardName} · Season ${record.seasonNumber||record.seasonId}`).setDescription(`**${w.playerName}**\n${w.teamName}${w.coachUserId?' · <@'+w.coachUserId+'>':''}\n\n${w.scope.replaceAll('_',' ')}: ${w.stats?.GP||0} GP · ${(w.stats?.PPG||0).toFixed(1)} PPG · ${(w.stats?.RPG||0).toFixed(1)} RPG · ${(w.stats?.APG||0).toFixed(1)} APG · ${(w.stats?.SPG||0).toFixed(1)} SPG · ${(w.stats?.BPG||0).toFixed(1)} BPG`);
        if(card.files?.length){const file=card.files[0],name=w.key+'-'+file.name;files.push(new AttachmentBuilder(file.attachment,{name}));embed.setThumbnail('attachment://'+name);}else if(/^https?:\/\//i.test(w.player.imageUrl||''))embed.setThumbnail(w.player.imageUrl);return embed;
      });
      const payload={embeds,files,attachments:[],allowedMentions:{parse:[],users:record.winners.map(w=>w.coachUserId).filter(Boolean)},nonce:require('crypto').createHash('sha256').update(lock+':'+record.revision).digest('hex').slice(0,24),enforceNonce:true};
      let message;if(record.publication?.messageId)message=await channel.messages.fetch(record.publication.messageId);
      if(message)await message.edit(payload);else message=await channel.send(payload);
      service.delivery(leagueId,record.seasonId,record.group,message.id,record.revision);
    })().finally(()=>publishing.delete(lock));publishing.set(lock,task);return task;
  }
  async function ensurePin(guild,leagueId){const settings=repository.loadSettings(leagueId),channel=await guild.channels.fetch(settings.discordChannels?.seasonAwards);if(!channel)return;let message;if(settings.awardsMessageId)try{message=await channel.messages.fetch(settings.awardsMessageId);}catch(error){if(Number(error.code)!==10008)throw error;}if(message)await message.edit(hubPayload());else{message=await channel.send(hubPayload());await message.pin();repository.saveSettings(leagueId,{...settings,awardsMessageId:message.id});}return message;}
  async function prompt(i,draft){const key=GROUPS[draft.group].find(key=>!draft.winners[key]);if(!key){const p=service.prepare(draft.leagueId,draft.actor,draft.group,draft.winners,draft.reason);await i.editReply({content:p.selected.map(w=>`${w.awardName}: ${w.playerName} · ${w.teamName}`).join('\n'),components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('awards:confirm:'+p.token).setLabel('Confirm Entire Award Batch').setStyle(ButtonStyle.Success))]});return;}
    draft.key=key;await i.editReply({content:`Choose ${NAMES[key]}.`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('awards:search:'+draft.id).setLabel('Search Player').setStyle(ButtonStyle.Primary))]});}
  async function handle(i){try{requireLeagueStaff(i);const context=repository.loadLeagueContext({guildId:i.guildId}),actor={id:i.user.id,staffAuthorized:true},[,action,arg]=i.customId.split(':');
    if(action==='search'){const draft=drafts.get(arg);if(!draft||draft.actor.id!==actor.id||draft.leagueId!==context.league.leagueId)throw Error('Award selection expired.');await i.showModal(new ModalBuilder().setCustomId('awards:search-save:'+arg).setTitle('Find award winner').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('query').setLabel('Player name').setStyle(TextInputStyle.Short)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Correction reason (if already published)').setRequired(false).setStyle(TextInputStyle.Short))));return;}
    await i.deferReply({flags:64});
    if(action==='start'){if(!GROUPS[arg])throw Error('Unknown award group.');const id=require('crypto').randomUUID(),draft={id,group:arg,leagueId:context.league.leagueId,actor,winners:{}};drafts.set(id,draft);await prompt(i,draft);}
    else if(action==='search-save'){const d=drafts.get(arg);if(!d||d.actor.id!==actor.id||d.leagueId!==context.league.leagueId)throw Error('Award selection expired.');d.reason=i.fields.getTextInputValue('reason')||d.reason;const found=service.search(d.leagueId,actor,i.fields.getTextInputValue('query'));if(!found.length)throw Error('No matching player. Try another name.');d.candidates=found.map(p=>p.playerId);await i.editReply({content:`Select ${NAMES[d.key]}.`,components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('awards:select:'+arg).addOptions(found.map(p=>({label:p.name.slice(0,100),description:p.teamName.slice(0,100),value:p.playerId}))))]});}
    else if(action==='select'){const d=drafts.get(arg);if(!d||d.actor.id!==actor.id||d.leagueId!==context.league.leagueId||!d.candidates?.includes(i.values[0]))throw Error('Award selection expired.');d.winners[d.key]=i.values[0];await prompt(i,d);}
    else if(action==='confirm'){const record=service.confirm(context.league.leagueId,actor,arg);await publish(i.guild,context.league.leagueId,record);await i.editReply('Award batch confirmed and published.');}
    else throw Error('Unknown award control.');
  }catch(error){if(i.replied||i.deferred)await i.editReply({content:error.message,components:[]});else await i.reply({content:error.message,flags:64});}}
  return {service,handle,ensurePin,publish};
}
module.exports={createDiscordAwards,hubPayload};
