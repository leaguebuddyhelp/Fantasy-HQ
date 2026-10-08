const { EmbedBuilder } = require('discord.js');
const { teamEmoji } = require('../shared/team-emojis');
const nbaTeams = require('../../web/assets/nba/teams.json');
const DIVISIONS = {
  East: { Atlantic: ['BOS','BKN','NYK','PHI','TOR'], Central: ['CHI','CLE','DET','IND','MIL'], Southeast: ['ATL','CHA','MIA','ORL','WAS'] },
  West: { Northwest: ['DEN','MIN','OKC','POR','UTA'], Pacific: ['GSW','LAC','LAL','PHX','SAC'], Southwest: ['DAL','HOU','MEM','NOP','SAS'] },
};
function teamAbbreviation(team) {
  const key=String(team.abbreviation || team.teamId || '').toUpperCase();
  const aliases={PHO:'PHX',PHE:'PHX',GS:'GSW',UTH:'UTA',NO:'NOP',SAN:'SAS',WSH:'WAS'};
  return aliases[key] || nbaTeams.find(t=>[t.slug,t.name].some(n=>n.toLowerCase()===String(team.teamName||team.teamId).toLowerCase()))?.abbreviation || key;
}
function availableTeamsPayload(context, owners, { openOnly = false } = {}) {
  const ownerByTeam = new Map(owners.filter(o=>o.userId && !String(o.userId).startsWith('simulation:') && o.active!==false && !o.endedAt).map(o=>[o.teamId,o]));
  const open=context.teams.filter(t=>!ownerByTeam.has(t.teamId));
  const embed=new EmbedBuilder().setColor(0xffdc21).setTitle(openOnly?'🟢 Available Teams':'🏀 Team Ownership • Available Teams')
    .setDescription(`**${open.length} available** · ${context.teams.length-open.length} owned\n${openOnly?'Choose an open team and contact Staff to join.':'🟢 Open = available to claim · Owner names show assigned coaches.'}`)
    .setFooter({text: 'Live ownership · Use /availableteams to scan open teams'});
  for(const [conference,divisions] of Object.entries(DIVISIONS)) {
    for(const [division,abbreviations] of Object.entries(divisions)) {
      const teams=context.teams.filter(t=>abbreviations.includes(teamAbbreviation(t)) && (!openOnly || !ownerByTeam.has(t.teamId))).sort((a,b)=>teamAbbreviation(a).localeCompare(teamAbbreviation(b)));
      if(openOnly && !teams.length)continue;
      embed.addFields({name:`${conference==='East'?'🔵 East':'🔴 West'} · ${division}`,inline:true,value:teams.map(t=>{
        const abbreviation=teamAbbreviation(t),owner=ownerByTeam.get(t.teamId),label=owner ? /^\d+$/.test(String(owner.userId))?`<@${owner.userId}>`:String(owner.displayName||owner.username||owner.userId).replace(/[@*_`~|<>]/g,'').slice(0,40) : '🟢 Open';
        return `${teamEmoji(t.teamName)||teamEmoji(abbreviation)||'🏀'} **${abbreviation}** — ${label}`;
      }).join('\n')||'No teams.'});
    }
  }
  const other=context.teams.filter(t=>!Object.values(DIVISIONS).some(d=>Object.values(d).some(a=>a.includes(teamAbbreviation(t))))&&(!openOnly||!ownerByTeam.has(t.teamId)));
  if(other.length)embed.addFields({name:'Other Teams',value:other.map(t=>`${teamEmoji(t.teamName)||'🏀'} **${String(t.teamName||t.teamId).slice(0,45)}** — ${ownerByTeam.has(t.teamId)?'Owned':'🟢 Open'}`).join('\n').slice(0,1024)});
  if(openOnly&&!open.length)embed.setDescription('All teams currently have owners. Contact Staff to join the waiting list.');
  return {embeds:[embed],allowedMentions:{parse:[]}};
}
async function handleAvailableTeams(interaction,{repository,ownership,feeds}) {
  // Acknowledge in the shared slash-command router before fetching roles/members.
  ownership.invalidateMembers(interaction.guildId);
  await ownership.sync(interaction.guild);
  const context=repository.loadLeagueContext({guildId:interaction.guildId});
  await interaction.editReply(availableTeamsPayload(context,repository.loadOwners(context.league.leagueId),{openOnly:true}));
  await feeds.ensurePins(interaction.guild,context.league.leagueId);
}
module.exports={DIVISIONS,availableTeamsPayload,handleAvailableTeams};
