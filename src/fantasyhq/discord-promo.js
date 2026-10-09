const {availableTeamsPayload}=require('./discord-available-teams');
const PROMO_TEXT=`Looking for an organized, competitive NBA 2K league with more than just playing games? **Welcome to LEAGUEbuddy!**

🤖 **CUSTOM DISCORD BOT + WEBSITE**
📅 Automated schedules, private game threads & standings
📊 Box-score tracking, player stats & leaderboards
🔄 Interactive trades, committee voting & free agency
📈 Player upgrades & offseason progression
🎓 Custom draft classes, scouting reports & live mock drafts
📰 League news, Power Rankings & weekly awards
🎥 Stream integration & matchup previews
💵 Virtual Sportsbook with odds, props & parlays
🏆 Full playoffs, NBA Draft & offseason management

🔥 **30 NBA Teams | 48-Hour Game Windows | Active Competition**
We're building a complete NBA franchise experience with a custom-built system that handles the league from preseason to the NBA Finals and beyond.

🎮 **JOIN LEAGUEbuddy TODAY!**
🔗 **Discord:** https://discord.gg/QRdcXrWn2M`;
function promoPayload(context,owners){
 const payload=availableTeamsPayload(context,owners,{openOnly:true}),embed=payload.embeds[0],availability=embed.data.description;
 embed.setTitle('🏀 LEAGUEbuddy | NBA 2K MyNBA Online League 🏆').setDescription(PROMO_TEXT+'\n\n**🟢 OPEN TEAMS**\n'+availability).setFooter({text:'Open teams refreshed from current Discord coach assignments · /promo'});
 return payload;
}
async function handlePromo(i,{repository,ownership}){
 if(!i.guildId||!i.guild)throw Error('Use /promo inside your league Discord server.');
 ownership.invalidateMembers(i.guildId);await ownership.sync(i.guild);
 const context=repository.loadLeagueContext({guildId:i.guildId});
 await i.editReply(promoPayload(context,repository.loadOwners(context.league.leagueId)));
}
module.exports={PROMO_TEXT,promoPayload,handlePromo};
