const {EmbedBuilder,AttachmentBuilder}=require('discord.js');
const sharp=require('sharp');
const {publishPermanentPost}=require('./discord-permanent-post');
const xml=v=>String(v).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
async function progressionPayload({leagueId,seasonId,receipt,players,teams}){
 const byId=new Map(players.map(p=>[p.playerId,p])),byTeam=new Map(teams.map(t=>[t.teamId,t])),sort=sign=>receipt.changes.filter(c=>sign*c.change>0).sort((a,b)=>sign*(b.change-a.change)||b.overall-a.overall||a.playerId.localeCompare(b.playerId)).slice(0,10),groups=[sort(1),sort(-1)],marker=`PROGRESSION:${leagueId}:${seasonId}:${receipt.requestId}`,composites=[];
 let svg='<svg width="1200" height="970" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="970" fill="#151923"/>';
 for(let side=0;side<2;side++){
  const x=side*600;svg+=`<text x="${x+25}" y="45" fill="${side?'#f18c8c':'#8cd6ad'}" font-family="sans-serif" font-size="26">${side?'TOP 10 OVR DECREASES':'TOP 10 OVR INCREASES'}</text>`;
  for(let i=0;i<groups[side].length;i++){
   const c=groups[side][i],p=byId.get(c.playerId),y=75+i*86,team=c.teamName||byTeam.get(c.teamId)?.teamName||c.teamId;
   svg+=`<text x="${x+105}" y="${y+23}" fill="white" font-family="sans-serif" font-size="20">${xml(((i+1)+'. '+(p?.name||c.playerId)).slice(0,40))}</text><text x="${x+105}" y="${y+46}" fill="#a9b4c8" font-family="sans-serif" font-size="16">${xml(team)}</text><text x="${x+105}" y="${y+68}" fill="${side?'#f18c8c':'#8cd6ad'}" font-family="sans-serif" font-size="18">${c.previousOverall} → ${c.overall} OVR (${c.change>0?'+':''}${c.change})</text>`;
   if(p){const card=require('../shared/discord-player-card').nbaPlayerCard({...p,teamName:team},marker),file=card.files?.find(f=>f.name.startsWith('player-portrait'))||card.files?.[0];if(file)try{composites.push({input:await sharp(file.attachment).resize(72,72,{fit:'contain',background:'#151923'}).png().toBuffer(),left:x+20,top:y});}catch{ /* Existing team/name branding remains when an asset cannot be decoded. */ }}
  }
 }
 svg+='</svg>';const image=await sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
 const embed=new EmbedBuilder().setTitle('📈 OFFSEASON PLAYER PROGRESSION').setDescription(`${receipt.changes.length} verified players across ${receipt.verifiedTeamIds.length} teams.\nAll changes preserve their original OVR and team association.`).setColor(0xffdc21).setImage('attachment://progression.png').setFooter({text:marker});
 for(let side=0;side<2;side++)embed.addFields({name:side?'📉 Biggest fallers':'📈 Biggest risers',value:groups[side].map((c,i)=>`${i+1}. **${byId.get(c.playerId)?.name||c.playerId}** · ${c.previousOverall} → ${c.overall} (${c.change>0?'+':''}${c.change})`).join('\n').slice(0,1024)||'No matching changes.'});
 return {embeds:[embed],files:[new AttachmentBuilder(image,{name:'progression.png'})]};
}
function createDiscordProgression({repository,now=Date.now}){
 async function reconcile(guild,leagueId){
  const settings=repository.loadSettings(leagueId);if(settings.simulationId)return;
  for(const [seasonId,season] of Object.entries(repository.loadOffseason(leagueId)?.seasons||{})){
   const receipt=season.receipts?.PROGRESSION;if(!receipt?.confirmedAt||receipt.publication?.messageId)continue;
   const channelId=settings.discordChannels?.announcements;if(!channelId)throw Error('Set up the league announcements channel.');const channel=await guild.channels.fetch(channelId);
   await publishPermanentPost({key:`${repository.dataRoot}:${leagueId}:PROGRESSION:${receipt.requestId}`,channel,marker:`PROGRESSION:${leagueId}:${seasonId}:${receipt.requestId}`,receipt:receipt.publication,now,
    save:publication=>{const state=repository.loadOffseason(leagueId);state.seasons[seasonId].receipts.PROGRESSION.publication=publication;repository.commitLeagueFiles({leagueId,files:[{name:'offseason.json',value:state},{name:'audit-log.json',value:[...repository.loadAuditLog(leagueId),{action:'offseason.progression.publication',timestamp:new Date(now()).toISOString(),metadata:{seasonId,...publication}}]}]});},
    payload:()=>progressionPayload({leagueId,seasonId,receipt,players:repository.loadPlayers(leagueId),teams:repository.loadLeague(leagueId).teams})});
  }
 }
 return {reconcile};
}
module.exports={createDiscordProgression,progressionPayload};
