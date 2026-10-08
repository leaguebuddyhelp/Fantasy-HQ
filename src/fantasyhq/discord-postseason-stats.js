const {ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {statsPayload}=require('./discord-league-feeds');
function payload(repository,leagueId,scope='PLAYOFFS') {
  const context=repository.loadLeague(leagueId);
  const players=require('./player-stats-service').createPlayerStatsService({repository,scope}).getSeasonPlayerStats(leagueId,context.seasonId);
  const result=statsPayload(players,context,scope);
  result.embeds[0].setTitle(scope==='PLAY_IN'?'📊 PLAY-IN STAT LEADERS':'📊 PLAYOFF STAT LEADERS').setDescription('Top 5 per category · Official approved games only · Play-In and Playoff statistics are separate. Shooting leaders require 8 attempts per player game in this scope.').setFooter({text:`Season ${context.league.seasonNumber} · ${scope.replaceAll('_',' ')}`});
  result.components=[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('poststats:PLAY_IN').setLabel('Play-In Stats').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('poststats:PLAYOFFS').setLabel('Playoff Stats').setStyle(ButtonStyle.Primary))];return result;
}
function createDiscordPostseasonStats({repository}) {
  async function ensurePin(guild,leagueId) {
    const settings=repository.loadSettings(leagueId),channel=await guild.channels.fetch(settings.discordChannels?.playoffStats);
    if(!channel)return;
    let message;if(settings.playoffStatsMessageId)try{message=await channel.messages.fetch(settings.playoffStatsMessageId);}catch(error){if(Number(error.code)!==10008)throw error;}
    if(message)await message.edit(payload(repository,leagueId));else{message=await channel.send(payload(repository,leagueId));await message.pin();repository.saveSettings(leagueId,{...settings,playoffStatsMessageId:message.id});}return message;
  }
  async function handle(i) {await i.deferReply({flags:64});try{const c=repository.loadLeagueContext({guildId:i.guildId});await i.editReply(payload(repository,c.league.leagueId,i.customId.split(':')[1]));}catch(error){await i.editReply(error.message);}}
  return {ensurePin,handle};
}
module.exports={createDiscordPostseasonStats,payload};
