const {ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder}=require('discord.js');
const {canManageLeague}=require('./discord-permissions');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function parseGameDate(value) {
 const input = String(value).trim();
 const named = input.match(/^([a-z]+)\.?\s+(\d{1,2})$/i);
 const numeric = input.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
 let month, day, year = 2000;
 if (named) {
  const name = named[1].toLowerCase();
  month = MONTH_NAMES.findIndex((full, index) => name === full || name === MONTHS[index].toLowerCase() || (index === 8 && name === 'sept')) + 1;
  day = Number(named[2]);
 } else if (numeric) {
  month = Number(numeric[1]); day = Number(numeric[2]);
  if (numeric[3]) year = Number(numeric[3]);
 } else throw Error('Enter the month and day shown in NBA 2K, for example Nov 18, Dec 19, or Oct 24.');
 const date = new Date(Date.UTC(year, month - 1, day));
 if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw Error('Enter a valid calendar date, for example Nov 18.');
 return `${MONTHS[month - 1]} ${day}`;
}
function formatGameDate(value) {
 try { return parseGameDate(value); } catch { return value; }
}
function createGameDateHandler(service){
 return async function handle(i){
  try{
   const [,id]=i.customId.split(':');
   const authorize=()=>service.authorizeExtraction(id,{guildId:i.guildId,discordThreadId:i.channelId,privateThread:i.channel?.type===12,userId:i.user.id},canManageLeague(i));
   authorize();
   if(i.isButton()){
    const field=new TextInputBuilder().setCustomId('date').setLabel('Date shown in NBA 2K (month and day)').setPlaceholder('Example: Nov 18').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20);
    const value=service.load(id).game.inGameDate;if(value)field.setValue(formatGameDate(value));
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
module.exports={parseGameDate,formatGameDate,createGameDateHandler};
