const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags}=require('discord.js');
const {randomUUID}=require('crypto');
const {publishPermanentPost}=require('./discord-permanent-post');
const carts=new Map();
const money=c=>'$'+((c||0)/100).toFixed(2);
const odds=n=>n>0?'+'+n:String(n);
const button=(id,label)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
function createDiscordSportsbook({repository,submissions,now=Date.now}) {
 const service=require('./sportsbook-service').createSportsbookService({repository,submissions,now});
 function label(m,context){const teams=new Map(context.teams.map(t=>[t.teamId,t.teamName]));return `${m.playerName||teams.get(m.selection)||m.selection} · ${m.kind} ${m.line??m.threshold??''} · ${odds(m.odds)}`;}
 function controls(){return row(button('book:open','🎟️ Markets'),button('book:wallet:0','💵 Wallet & bets'),button('book:leaderboard','🏆 Leaderboard'));}
 function marketPanel(context,actor,cart,page=0){
  const state=service.refresh(context.league.leagueId),team=require('./coach-identity').requireCoachIdentity(repository,context,actor.member,actor.id).teamId;
  const markets=state.markets.filter(m=>m.status==='OPEN'&&m.seasonId===context.seasonId&&m.week===context.league.currentWeek&&m.simulationId===(repository.loadSettings(context.league.leagueId).simulationId||null)&&!m.teamIds.includes(team));
  page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(markets.length/25)-1)));cart.markets=markets;cart.page=page;
  const embed=new EmbedBuilder().setTitle('🎟️ Sportsbook · Week '+context.league.currentWeek).setColor(0xffdc21).setDescription('Fictional league dollars. Select a line to add it to your slip. Select it again to remove it. Up to five different markets per parlay. Betting closes when a Streamlink is submitted.\n\n**Your slip**\n'+(cart.ids.map(id=>{const m=state.markets.find(m=>m.id===id);return m?label(m,context):'Unavailable line';}).join('\n')||'No selections yet.'));
  const components=[];
  if(markets.length)components.push(row(new StringSelectMenuBuilder().setCustomId('book:select:'+cart.id).setPlaceholder('Choose a line · page '+(page+1)).addOptions(markets.slice(page*25,page*25+25).map((m,j)=>({label:label(m,context).slice(0,100),description:('Game '+m.gameId).slice(0,100),value:String(page*25+j),default:cart.ids.includes(m.id)})))));
  components.push(row(button('book:page:'+cart.id+':'+(page-1),'Previous').setDisabled(page===0),button('book:page:'+cart.id+':'+(page+1),'Next').setDisabled((page+1)*25>=markets.length),button('book:wager:'+cart.id,'Review wager').setDisabled(!cart.ids.length),button('book:clear:'+cart.id,'Clear slip')),controls());
  return {embeds:[embed],components,allowedMentions:{parse:[]}};
 }
 async function handle(i){
  try {
   const context=repository.loadLeagueContext({guildId:i.guildId}),leagueId=context.league.leagueId,actor={id:i.user.id,member:i.member,guildId:i.guildId};
   const parts=i.customId.split(':'),action=i.customId==='coachweb:open'?'open':parts[1];
   const staff=['staff','correction','resolve'].includes(action);
   if(staff){require('./discord-permissions').requireLeagueStaff(i);actor.staffAuthorized=true;}else require('./coach-identity').requireCoachIdentity(repository,context,i.member,i.user.id);
   const respond=async payload=>{if(i.deferred||i.replied)return i.editReply(payload);if(i.isMessageComponent?.()&&i.message?.flags?.has(MessageFlags.Ephemeral))return i.update(payload);return i.reply({...payload,flags:MessageFlags.Ephemeral});};
   function cartFor(id){const c=carts.get(id);if(!c||c.userId!==actor.id||c.leagueId!==leagueId||c.root!==repository.dataRoot||c.expiresAt<=now())throw Error('Your slip expired. Open Sportsbook again.');return c;}
   for(const [id,c]of carts)if(c.expiresAt<=now())carts.delete(id);
   if(action==='wager'){const cart=cartFor(parts[2]);return await i.showModal(new ModalBuilder().setCustomId('book:stake:'+cart.id).setTitle('Review your wager').addComponents(row(new TextInputBuilder().setCustomId('amount').setLabel('Wager in league dollars ($1–$50; parlay $25)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8))));}
   if(i.isMessageComponent?.()&&i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});
   if(['open','page','select','clear'].includes(action)){
    let cart;if(action==='open'){cart={id:randomUUID(),userId:actor.id,leagueId,root:repository.dataRoot,expiresAt:now()+900000,ids:[]};carts.set(cart.id,cart);}else cart=cartFor(parts[2]);
    if(action==='clear')cart.ids=[];
    if(action==='select'){const selected=cart.markets[Number(i.values[0])];if(!selected)throw Error('Choose a current market.');if(cart.ids.includes(selected.id))cart.ids=cart.ids.filter(id=>id!==selected.id);else{if(cart.ids.length>=5)throw Error('A parlay allows at most five selections.');if(cart.ids.some(id=>cart.markets.find(m=>m.id===id)?.group===selected.group))throw Error('Remove the conflicting selection from your slip first.');cart.ids.push(selected.id);}}
    return await respond(marketPanel(context,actor,cart,action==='page'?Number(parts[3]):cart.page||0));
   }
   if(action==='stake'){const cart=cartFor(parts[2]),p=service.preview(leagueId,actor,{marketIds:cart.ids,wager:i.fields.getTextInputValue('amount')});return await respond({embeds:[new EmbedBuilder().setTitle(p.legs.length===1?'Review straight bet':'Review parlay').setDescription(p.legs.map(m=>label(m,context)).join('\n')+`\n\nStake ${money(p.stakeCents)} · Odds ${odds(p.combinedAmericanOdds)}\nPotential profit ${money(p.profitCents)} · Total return ${money(p.potentialReturnCents)}\nConfirm within five minutes.`)],components:[row(button('book:confirm:'+p.id,'Confirm wager')),controls()]});}
   if(action==='confirm'){const bet=service.confirm(leagueId,actor,parts[2]);return await respond({content:`✅ Wager confirmed · ${money(bet.stakeCents)} · ${bet.status}\nBalance ${money(service.mine(leagueId,actor).profile.balanceCents)}`,embeds:[],components:[controls()]});}
   if(action==='wallet'){const data=service.mine(leagueId,actor),page=Math.max(0,Math.min(Number(parts[2])||0,Math.max(0,Math.ceil(data.bets.length/5)-1))),bets=[...data.bets].reverse();return await respond({embeds:[new EmbedBuilder().setTitle('💵 Your private wallet & bets').setDescription(`Balance ${money(data.profile.balanceCents)} · Debt ${money(data.profile.debtCents)}\nCareer profit ${money(data.profile.careerProfitCents)} · ${data.profile.wins} W / ${data.profile.losses} L${data.profile.frozen?'\n⚠️ Corrected payout awaits Staff review.':''}\n\n`+(bets.slice(page*5,page*5+5).map(b=>`**${b.status}** · ${money(b.stakeCents)} · ${b.placedAt}\n${b.legs.map(m=>label(m,context)).join('\n')}\nLatest return ${money(b.settlements.at(-1)?.returnCents)}`).join('\n\n')||'No bets yet.'))],components:[row(button('book:wallet:'+(page-1),'Previous').setDisabled(!page),button('book:wallet:'+(page+1),'Next').setDisabled((page+1)*5>=bets.length)),controls()]});}
   if(action==='leaderboard')return await respond({embeds:[new EmbedBuilder().setTitle('🏆 Sportsbook career leaderboard').setDescription(service.leaderboard(leagueId).slice(0,10).map((p,j)=>`${j+1}. ${p.displayName} · ${money(p.careerProfitCents)} profit · ${p.wins} W / ${p.losses} L`).join('\n')||'No wagers yet.')],components:[controls()],allowedMentions:{parse:[]}});
   if(action==='staff'){const data=service.staff(leagueId,actor),pending=data.bets.filter(b=>b.pendingCorrection),page=Math.max(0,Math.min(Number(parts[2])||0,Math.max(0,Math.ceil(pending.length/25)-1))),components=[];if(pending.length)components.push(row(new StringSelectMenuBuilder().setCustomId('book:correction').setPlaceholder('Review corrected payout').addOptions(pending.slice(page*25,page*25+25).map(b=>({label:('Coach '+b.userId+' · '+money(b.pendingCorrection.adjustmentCents)).slice(0,100),value:b.id})))));components.push(row(button('book:staff:'+(page-1),'Previous').setDisabled(!page),button('book:staff:'+(page+1),'Next').setDisabled((page+1)*25>=pending.length)));return await respond({embeds:[new EmbedBuilder().setTitle('🎟️ Sportsbook Staff Review').setDescription(`${pending.length} corrected payouts · ${data.bets.filter(b=>b.status==='OPEN').length} open bets\n\n**Latest ledger entries**\n`+data.ledger.slice(-10).map(e=>`${e.userId} · ${e.type} · ${money(e.amountCents)}`).join('\n'))],components,allowedMentions:{parse:[]}});}
   if(action==='correction'){const p=service.prepareCorrection(leagueId,actor,i.values[0]);return await respond({content:`Review corrected payout: ${money(p.adjustmentCents)}\nRecover ${money(-p.appliedCents)} from wallet; carry ${money(p.debtCents)} as debt repaid from future credits. Historical settlements remain available.`,components:[row(button('book:resolve:'+p.id,'Confirm correction'),button('book:staff:0','Back to review'))]});}
   if(action==='resolve'){service.confirmCorrection(leagueId,actor,parts[2]);return await respond({content:'✅ Correction recorded. Future credits repay outstanding debt.',components:[row(button('book:staff:0','Review payouts'))]});}
   throw Error('Open Sportsbook again to continue.');
  } catch(error){const payload={content:error.message,embeds:[],components:[],allowedMentions:{parse:[]}};if(i.deferred||i.replied)await i.editReply(payload);else await i.reply({...payload,flags:MessageFlags.Ephemeral});}
 }
 async function reconcile(guild,leagueId){
  const settings=repository.loadSettings(leagueId),context=repository.loadLeague(leagueId);
  if(settings.discordChannels?.staff){const channel=await guild.channels.fetch(settings.discordChannels.staff);await require('../shared/discord-singleton-panel').ensureSingletonPanel({key:repository.dataRoot+':'+leagueId+':sportsbook',channel,botId:guild.members.me.id,savedId:settings.sportsbookStaffMessageId,title:'🎟️ Sportsbook Staff Review',payload:{embeds:[new EmbedBuilder().setTitle('🎟️ Sportsbook Staff Review').setDescription('Review corrected payouts and the private wager ledger. Confirm each correction before applying it.')],components:[row(button('book:staff:0','Review payouts'))],allowedMentions:{parse:[]}},save:id=>repository.saveSettings(leagueId,{...repository.loadSettings(leagueId),sportsbookStaffMessageId:id})});}
  if(settings.simulationId||context.league.currentPhase!=='REGULAR_SEASON')return;
  const state=service.refresh(leagueId),markets=state.markets.filter(m=>m.seasonId===context.seasonId&&m.week===context.league.currentWeek&&m.status==='OPEN'&&!m.simulationId);if(!markets.length)return;
  const key=`${context.seasonId}:W${context.league.currentWeek}`,receipt=state.publications?.[key],channelId=settings.discordChannels?.announcements;if(!channelId)throw Error('Set up the weekly announcement channel.');
  const channel=await guild.channels.fetch(channelId),payload={embeds:[new EmbedBuilder().setTitle('🏀 LEAGUEbuddy Sportsbook is open').setColor(0xffdc21).setDescription(`Week ${context.league.currentWeek} lines, player props, Weekly Specials and parlays are available in Discord.\n\nFictional league dollars only. Your wallet, slip and bet history are private. Betting closes when a game’s Streamlink is submitted.`).setFooter({text:'SPORTSBOOK:'+leagueId+':'+key})],components:[controls()],allowedMentions:{parse:[]}};
  if(receipt?.messageId){let message;try{message=await channel.messages.fetch(receipt.messageId);}catch(error){if(Number(error.code)!==10008)throw error;}if(message){if(message.author.id!==guild.members.me.id)throw Error('Sportsbook announcement identity mismatch.');await message.edit(payload);return;}}
  await publishPermanentPost({key:repository.dataRoot+':sportsbook:'+key,channel,marker:'SPORTSBOOK:'+leagueId+':'+key,receipt:receipt?.messageId?null:receipt,now,payload:async()=>payload,save:receipt=>service.publication(leagueId,key,receipt)});
 }
 return {handle,reconcile};
}
module.exports={createDiscordSportsbook};
