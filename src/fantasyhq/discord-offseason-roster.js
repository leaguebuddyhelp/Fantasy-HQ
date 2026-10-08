const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder}=require('discord.js');
const {requireCoachIdentity}=require('./coach-identity');
function createDiscordOffseasonRoster({repository}){
 const service=require('./offseason-roster-service').createOffseasonRosterService({repository});
 async function handle(i){
  await i.deferReply({flags:64});
  try {
   const context=repository.loadLeagueContext({guildId:i.guildId}),leagueId=context.league.leagueId;
   const identity=requireCoachIdentity(repository,context,i.member,i.user.id),actor={id:i.user.id};
   const [,action,token]=i.customId.split(':');
   if(action==='confirm'){const receipt=service.confirmWaiver(leagueId,actor,token);if(receipt.teamId!==identity.teamId)throw Error('This confirmation belongs to another team.');await i.editReply({content:'Player waived. Your roster and contract history have been updated.',components:[]});return;}
   if(action==='choose'){
    const view=service.inspect(leagueId),playerId=i.values[0];if(!view.teams.find(t=>t.teamId===identity.teamId)?.players.some(p=>p.playerId===playerId))throw Error('Choose a player on your own team.');
    const p=service.prepareWaiver(leagueId,actor,playerId);await i.editReply({content:`Waive **${p.playerName}**? This releases the player and ends their current contract.`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cutdown:confirm:'+p.token).setLabel('Confirm waiver').setStyle(ButtonStyle.Danger))]});return;
   }
   const view=service.inspect(leagueId),team=view.teams.find(t=>t.teamId===identity.teamId),eligible=team.players.filter(p=>!p.protected);
   const embed=new EmbedBuilder().setTitle('✂️ '+team.teamName+' roster cutdown').setColor(0xffdc21).setDescription(`${team.count}/15 players · ${Math.max(0,team.count-15)} cuts needed\nPlayers rated 85+ OVR cannot be waived.\n${view.window?.deadlineAt?'Deadline: <t:'+Math.floor(Date.parse(view.window.deadlineAt)/1000)+':F>':'Staff has not opened the cutdown period.'}`);
   const components=team.count>15&&eligible.length&&view.window?.status==='OPEN'?[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('cutdown:choose').setPlaceholder('Choose a player to waive').addOptions(eligible.slice(0,25).map(p=>({label:String(p.name).slice(0,100),value:p.playerId,description:`${p.overall} OVR`})) ) )]:[];
   await i.editReply({embeds:[embed],components});
  }catch(error){await i.editReply({content:error.message,components:[]});}
 }
 return {handle,service};
}
module.exports={createDiscordOffseasonRoster};
