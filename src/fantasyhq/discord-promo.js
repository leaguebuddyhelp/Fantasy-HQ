const {activeOwnersByTeam}=require('./discord-available-teams');
const PROMO_TEXT=`🏀 **LEAGUEbuddy | NBA 2K MyNBA Online League**
We're starting a new NBA 2K online league built around a custom Discord bot and companion website!
**League Features:**
📅 48-hour game windows & automated scheduling
📊 Box-score tracking, standings & player stats
🔄 Trades, free agency & player upgrades
🎓 Custom draft classes, scouting & mock drafts
🏆 Playoffs, awards & full offseason management
📰 League news & Power Rankings`;
function promoPayload(context,owners){
 const ownerByTeam=activeOwnersByTeam(owners);
 const open=context.teams.filter(team=>!ownerByTeam.has(team.teamId))
   .map(team=>team.teamName||team.abbreviation||team.teamId).sort((a,b)=>a.localeCompare(b));
 const availability=open.length ? `**OPEN TEAMS (${open.length})**\n${open.join('\n')}`
   : 'All teams currently have owners. Contact Staff to join the waiting list.';
 return {content:`${PROMO_TEXT}\n\n${availability}`,embeds:[],allowedMentions:{parse:[]}};
}
async function handlePromo(i,{repository,ownership}){
 if(!i.guildId||!i.guild)throw Error('Use /promo inside your league Discord server.');
 ownership.invalidateMembers(i.guildId);await ownership.sync(i.guild);
 const context=repository.loadLeagueContext({guildId:i.guildId});
 await i.editReply(promoPayload(context,repository.loadOwners(context.league.leagueId)));
}
module.exports={PROMO_TEXT,promoPayload,handlePromo};
