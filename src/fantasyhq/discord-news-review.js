const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {requireLeagueStaff}=require('./discord-permissions');
const {createNewsService}=require('./news-service');

function createDiscordNewsReview({repository,submissions}) {
 const service=createNewsService({repository,submissions});
 const actor=interaction=>{requireLeagueStaff(interaction);return {authorized:true,staffAuthorized:true,id:interaction.user.id};};
 const leagueOf=interaction=>repository.loadLeagueContext({guildId:interaction.guildId}).league.leagueId;
 const drafts=(leagueId,who)=>service.staffList(leagueId,who).filter(a=>a.status==='DRAFT'&&!a.revalidationRequired).sort((a,b)=>b.newsworthiness-a.newsworthiness||a.id.localeCompare(b.id));
 function payload(list,index,note) {
  if(!list.length)return {content:(note?note+'\n':'')+'📰 No news drafts are waiting for review.',embeds:[],components:[]};
  const i=Math.min(index,list.length-1),story=list[i];
  const embed=new EmbedBuilder().setColor(0xffdc21).setTitle(story.headline.slice(0,256)).setDescription(story.article.slice(0,4000))
   .setFooter({text:`Draft ${i+1} of ${list.length} · ${story.category}${story.week?' · Week '+story.week:''}`});
  const button=(id,label,style)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  return {content:note||'',embeds:[embed],components:[new ActionRowBuilder().addComponents(
   button('newsrev:a:'+story.id,'Approve',ButtonStyle.Success),button('newsrev:r:'+story.id,'Reject',ButtonStyle.Danger),
   button('newsrev:s:'+(i+1<list.length?i+1:0),'Skip',ButtonStyle.Secondary),button('newsrev:all:0','Approve all',ButtonStyle.Primary))]};
 }
 async function command(interaction) {
  const who=actor(interaction),leagueId=leagueOf(interaction);
  await interaction.editReply(payload(drafts(leagueId,who),0));
 }
 async function button(interaction) {
  const who=actor(interaction),leagueId=leagueOf(interaction),[,action,value]=interaction.customId.split(':');
  let note='';
  try {
   if(action==='a'){service.review(leagueId,who,{id:value,action:'approve'});service.publishDue(leagueId);note='✅ Approved. Approved stories publish on the news schedule.';}
   else if(action==='r'){service.review(leagueId,who,{id:value,action:'reject',reason:'Rejected by staff in Discord.'});note='❌ Rejected.';}
   else if(action==='all'){const list=drafts(leagueId,who);let count=0;for(const story of list){try{service.review(leagueId,who,{id:story.id,action:'approve'});count++;}catch{}}service.publishDue(leagueId);note=`✅ Approved ${count} draft${count===1?'':'s'}. They publish on the news schedule.`;}
  } catch(error){note='⚠️ '+error.message;}
  const list=drafts(leagueId,who);
  await interaction.update(payload(list,action==='s'?Number(value)||0:0,note));
 }
 return {command,button};
}
module.exports={createDiscordNewsReview};
