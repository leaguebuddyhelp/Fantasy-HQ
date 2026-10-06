const teams = require('../../web/assets/nba/teams.json');
// These names match the application emojis supplied by the league commissioner.
const aliases = { BKN:'bkn', PHX:'phe', PHO:'phe', GSW:'gs', UTA:'uth', NOP:'no', SAS:'san', WAS:'wsh' };
const emojis = new Map();
function emojiName(team) { return aliases[team.abbreviation] || team.abbreviation.toLowerCase(); }
function setTeamEmojis(collection) {
  emojis.clear();
  for (const emoji of collection.values()) {
    if (emoji.available === false || !/^\d+$/.test(String(emoji.id))) continue;
    emojis.set(String(emoji.name).toLowerCase(), `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`);
  }
}
function teamEmoji(value) {
  const key=String(value || '').trim().toLowerCase();
  const team=teams.find(t=>[t.name,t.slug,t.abbreviation].some(v=>v.toLowerCase()===key));
  return team ? emojis.get(emojiName(team)) || '' : '';
}
function teamLabel(value) { const emoji=teamEmoji(value); return emoji ? `${emoji} ${value}` : String(value || ''); }
async function loadTeamEmojis(client, logger=console) {
  try {
    setTeamEmojis(await client.application.emojis.fetch());
    const missing=teams.filter(t=>!teamEmoji(t.name)).map(t=>emojiName(t));
    logger.log(`Team emojis loaded: ${teams.length-missing.length}/${teams.length}.${missing.length?' Missing: '+missing.join(', '):''}`);
  } catch(error) { logger.warn(`Team emojis unavailable; team names remain readable: ${error.message}`); }
}
module.exports={teamEmoji,teamLabel,loadTeamEmojis,setTeamEmojis};
