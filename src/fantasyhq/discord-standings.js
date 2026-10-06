const {teamLabel}=require("../shared/team-emojis");
const {EmbedBuilder}=require('discord.js');
const {createStandingsService,formatPct}=require('./standings-service');
function standingsPayload(standings,conference){
 const keys=conference?[conference]:['East','West'];
 return {embeds:keys.map(key=>new EmbedBuilder().setColor(0xffdc21).setTitle(`${key==='East'?'EASTERN':'WESTERN'} CONFERENCE`)
 .setDescription((standings.conferences[key] || []).map(t=>`**${t.rank}. ${teamLabel(t.teamName)}** · ${t.W}–${t.L} · ${formatPct(t.PCT)}\nGP ${t.GP} · PF ${t.PF} · PA ${t.PA} · DIFF ${t.DIFF>0?'+':''}${t.DIFF}`).join('\n\n') || 'No teams.')
 .setFooter({text:`Regular season · ${standings.currentWeek?'Week '+standings.currentWeek:'Not started'} · Official results only`})) ,allowedMentions:{parse:[]}};
}
async function handleStandings(interaction,service=createStandingsService(),repository=require('./repository').createFantasyHQRepository()){
 const context=repository.loadLeagueContext({guildId:interaction.guildId});
 await interaction.editReply(standingsPayload(service.getStandings(context.league.leagueId,context.seasonId),interaction.options.getString('conference')));
}
module.exports={standingsPayload,handleStandings};
