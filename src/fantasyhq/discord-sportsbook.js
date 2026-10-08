const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {publishPermanentPost}=require('./discord-permanent-post');
function createDiscordSportsbook({repository,submissions,now=Date.now}) {
 const service=require('./sportsbook-service').createSportsbookService({repository,submissions,now});
 async function reconcile(guild,leagueId) {
  const settings=repository.loadSettings(leagueId),context=repository.loadLeague(leagueId);
  if(settings.simulationId||context.league.currentPhase!=='REGULAR_SEASON')return;
  const state=service.refresh(leagueId),markets=state.markets.filter(m=>m.seasonId===context.seasonId&&m.week===context.league.currentWeek&&m.status==='OPEN'&&!m.simulationId);
  if(!markets.length)return;
  const key=`${context.seasonId}:W${context.league.currentWeek}`,receipt=state.publications?.[key];if(receipt?.messageId)return;
  const channelId=settings.discordChannels?.announcements;if(!channelId)throw Error('Set up the weekly announcement channel.');
  const channel=await guild.channels.fetch(channelId),url=require('./coach-web-session').websiteBase();url.pathname='/';url.search='';url.hash='sportsbook';
  const teams=new Map(context.teams.map(team=>[team.teamId,team.teamName])),games=[...new Set(markets.map(m=>m.gameId))].slice(0,3).map(id=>submissions.load(id).game);
  const specials=markets.filter(m=>m.specialId),odds=n=>n>0?'+'+n:String(n);
  const embed=new EmbedBuilder().setTitle('🏀 LEAGUEbuddy Sportsbook is open').setColor(0xffdc21)
   .setDescription(`Week ${context.league.currentWeek} betting is available. View game lines, verified player props, Weekly Specials and parlays on the website.\n\n**Featured matchups**\n${games.map(g=>require('../shared/team-emojis').teamLabel(g.team1Name)+' vs '+require('../shared/team-emojis').teamLabel(g.team2Name)).join('\n')}\n\n**🔥 Weekly Specials**\n${specials.map(m=>m.specialName+' · '+(m.playerName?m.playerName+' '+m.threshold+'+ '+m.kind.slice(5):teams.get(m.selection)+' ML')+' '+odds(m.odds)).join('\n')||'Specials need sufficiently reliable league data and will appear when eligible.'}\n\nFictional league dollars only. Betting closes when a game’s Streamlink is submitted. Sign in privately through Discord MyTeam.`)
   .setFooter({text:'SPORTSBOOK:'+leagueId+':'+key});
  await publishPermanentPost({key:repository.dataRoot+':sportsbook:'+key,channel,marker:'SPORTSBOOK:'+leagueId+':'+key,receipt,now,
   payload:async()=>({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('💵 Bet this week').setStyle(ButtonStyle.Link).setURL(url.href))],allowedMentions:{parse:[]}}),save:receipt=>service.publication(leagueId,key,receipt)});
 }
 return {reconcile};
}
module.exports={createDiscordSportsbook};
