const {EmbedBuilder}=require('discord.js');
const {publishPermanentPost}=require('./discord-permanent-post');
const {rankOffseasonOffers}=require('./offseason-offer-score');
function createDiscordOffseasonMarket({repository,now=Date.now}){
 async function reconcile(guild,leagueId){const settings=repository.loadSettings(leagueId);if(settings.simulationId)return;const context=repository.loadLeague(leagueId),players=repository.loadPlayers(leagueId),state=repository.loadFreeAgencyState(leagueId),market=state.offseason?.[context.seasonId];if(!market)return;
  const stage=market.stages.at(-1),byPlayer=new Map(players.map(p=>[p.playerId,p])),teamName=id=>context.teams.find(t=>t.teamId===id)?.teamName||id;
  const save=(key,publication)=>{const fresh=repository.loadFreeAgencyState(leagueId),current=fresh.offseason[context.seasonId];current.publications ||= {};current.publications[key]=publication;repository.commitLeagueFiles({leagueId,files:[{name:'free-agency.json',value:fresh}]});};
  async function deliver(key,channel,body){const marker=`OFFSEASON_FA:${leagueId}:${context.seasonId}:${key}`;await publishPermanentPost({key:repository.dataRoot+':'+marker,channel,marker,receipt:repository.loadFreeAgencyState(leagueId).offseason[context.seasonId].publications?.[key],save:p=>save(key,p),now,payload:async()=>{const value=await body();value.embeds.at(-1).setFooter({text:marker});return value;}});}
  if(stage?.status==='OPEN'&&now()<Date.parse(stage.deadlineAt)){
   const remaining=Date.parse(stage.deadlineAt)-now(),hours=remaining<=3600000?1:remaining<=6*3600000?6:null;
   if(hours&&settings.discordChannels?.announcements){const channel=await guild.channels.fetch(settings.discordChannels.announcements);await deliver('reminder:'+stage.id+':'+stage.deadlineAt+':'+hours,channel,async()=>({embeds:[new EmbedBuilder().setTitle(`🏀 Offseason Free Agency · ${hours} hour reminder`).setColor(0xffdc21).setDescription(`${stage.name} closes <t:${Math.floor(Date.parse(stage.deadlineAt)/1000)}:F>.\nUse the Free Agency pin to submit, improve or withdraw your private offer. Five active offers; priorities 1–5.`)]}));}
   const active=market.offers.filter(o=>o.stageId===stage.id&&o.status==='ACTIVE');
   for(const playerId of new Set(active.map(o=>o.playerId))){const p=byPlayer.get(playerId);if(!p)continue;const bids=rankOffseasonOffers(active.filter(o=>o.playerId===playerId),p),leader=bids[0];for(const offer of bids.slice(1)){
    if(!repository.loadOwners(leagueId).some(o=>o.teamId===offer.teamId&&o.userId===offer.coachUserId))continue;const key='outbid:'+offer.id+':'+leader.id;if(market.publications?.[key]?.messageId)continue;
    try {const user=await guild.client.users.fetch(offer.coachUserId),channel=await user.createDM();await deliver(key,channel,async()=>({embeds:[new EmbedBuilder().setTitle('📝 Your offer has been outbid').setColor(0xffdc21).setDescription(`Your current offer for **${p.name}** is behind another offer.\nYou can improve it through Free Agency before <t:${Math.floor(Date.parse(stage.deadlineAt)/1000)}:F>.\nOther coaches’ contract details remain private.`)]}));}catch(error){if(error.code!==50007)throw error;}
   }}
  }
  const channelId=settings.discordChannels?.announcements;if(!channelId)return;const channel=await guild.channels.fetch(channelId);
  for(const o of market.offers.filter(o=>o.status==='WON')){const key='signing:'+o.id;if(market.publications?.[key]?.messageId)continue;const p=byPlayer.get(o.playerId);if(!p)throw Error('Signing references an unknown player.');await deliver(key,channel,async()=>{const card=require('../shared/discord-player-card').nbaPlayerCard({...p,teamName:teamName(o.teamId)},'Offseason signing');card.embeds[0].setTitle('📝 '+p.name+' signs with '+teamName(o.teamId)).setDescription(`${p.position1||'—'} · ${p.overall} OVR\n${o.contract.seasons.length} years · $${o.contract.seasons[0].salary.toLocaleString()} annual salary\n$${o.contract.seasons.reduce((n,s)=>n+s.salary,0).toLocaleString()} total value\nStaff-approved offseason contract.`);return {embeds:card.embeds,files:card.files};});}
 }
 return {reconcile};
}
module.exports={createDiscordOffseasonMarket};
