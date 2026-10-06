const {ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder}=require('discord.js');
const {canManageLeague}=require('./discord-permissions');
function parseGameDate(value){
 const match=String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 if(!match)throw Error('Enter the date shown in NBA 2K as MM/DD/YYYY, for example 10/24/2027.');
 const [,m,d,y]=match.map(Number),date=new Date(Date.UTC(y,m-1,d));
 if(y<1900||y>9999||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw Error('Enter a valid calendar date, for example 10/24/2027.');
 return `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}/${y}`;
}
function createGameDateHandler(service){
 return async function handle(i){
  try{
   const [,id]=i.customId.split(':');
   const authorize=()=>service.authorizeExtraction(id,{guildId:i.guildId,discordThreadId:i.channelId,privateThread:i.channel?.type===12,userId:i.user.id},canManageLeague(i));
   authorize();
   if(i.isButton()){
    const field=new TextInputBuilder().setCustomId('date').setLabel('Date shown in NBA 2K (MM/DD/YYYY)').setPlaceholder('Example: 10/24/2027').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10);
    const value=service.load(id).game.inGameDate;if(value)field.setValue(value);
    await i.showModal(new ModalBuilder().setCustomId(`gamedatesave:${id}`).setTitle('Set game date').addComponents(new ActionRowBuilder().addComponents(field)));return;
   }
   await i.deferReply({flags:64});
   const date=parseGameDate(i.fields.getTextInputValue('date'));
   await service.mutate(id,r=>{
    authorize();r.game.inGameDateHistory ||= [];r.game.inGameDateHistory.push({previous:r.game.inGameDate||null,date,userId:i.user.id,at:new Date().toISOString()});r.game.inGameDate=date;
   });
   const record=service.load(id);
   try{
    const message=await i.channel.messages.fetch(record.game.discordMessageId || i.message?.id);
    await message.edit(require('./discord-game-submissions').gamePayload(record.game,require('./game-activity').activityView(record)));
   }catch{await i.editReply(`**2K game date saved: ${date}.** The matchup message could not refresh. Use Set game date again to retry, or ask staff to run /games create.`);return;}
   await i.editReply(`**2K game date: ${date}** saved. The game buttons are now available in the matchup message.`);
  }catch(error){if(i.deferred||i.replied)await i.editReply(error.message);else await i.reply({content:error.message,flags:64});}
 };
}
module.exports={parseGameDate,createGameDateHandler};
