const {randomUUID}=require('crypto');
const {ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {requireLeagueStaff}=require('./discord-permissions');
function createDiscordSeasonStart({repository=require('./repository').createFantasyHQRepository(),now=()=>Date.now(),validator=require('./preseason-validator').createPreseasonValidator({repository}),leagueService=require('./league-service').createLeagueService({repository})}={}){
 const pending=new Map();
 async function handle(interaction){
  requireLeagueStaff(interaction);
  const c=repository.loadLeagueContext({guildId:interaction.guildId});
  const [,action,value]=interaction.customId.split(':');
  if(action==='startseason'){
   if(value!==c.league.leagueId)throw Error('League changed. Open /league setup again.');
   if(c.league.currentPhase!=='PRESEASON')throw Error('League must be in PRESEASON.');
   const result=validator.validate({leagueId:c.league.leagueId,seasonId:c.seasonId});
   if(!result.ready){await interaction.editReply({content:`Cannot start regular season:\n${result.errors.join('\n')}`.slice(0,1900),components:[]});return;}
   for(const [id,p] of pending)if(p.expires<now())pending.delete(id);
   const token=randomUUID();pending.set(token,{guildId:interaction.guildId,userId:interaction.user.id,leagueId:c.league.leagueId,seasonId:c.seasonId,expires:now()+300000});
   await interaction.editReply({content:'Start the regular season? This activates Week 1. Its 48-hour countdown starts when game threads are created. After starting, use /games create to open the matchup threads.',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`setupflow:startconfirm:${token}`).setLabel('Start regular season').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`setupflow:startcancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))]});return;
  }
  const p=pending.get(value);
  if(!p||p.userId!==interaction.user.id||p.guildId!==interaction.guildId||p.leagueId!==c.league.leagueId||p.seasonId!==c.seasonId||p.expires<now())throw Error('Confirmation expired or belongs to another session. Open /league setup again.');
  if(action==='startcancel'){pending.delete(value);await interaction.editReply({content:'Season start cancelled.',components:[]});return;}
  if(action!=='startconfirm')throw Error('Unknown season action.');
  if(c.league.currentPhase!=='PRESEASON')throw Error('Season phase changed. Open /league setup again.');
  leagueService.startRegularSeason({leagueId:p.leagueId,seasonId:p.seasonId,actingUserId:p.userId,validator:params=>validator.validate(params)});
  pending.delete(value);
  await interaction.editReply({content:'Regular season started. Week 1 is active. Its 48-hour countdown starts when game threads are created. Run /games create to create its private matchup threads.',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setupflow:refresh').setLabel('Back to league setup').setStyle(ButtonStyle.Secondary))]});
 }
 return {handle};
}
module.exports={createDiscordSeasonStart};
