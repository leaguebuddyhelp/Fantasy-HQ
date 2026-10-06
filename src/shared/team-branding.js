const path = require("path");
const { AttachmentBuilder } = require("discord.js");
const {teamEmoji,teamLabel}=require("./team-emojis");
const teams = require("../../web/assets/nba/teams.json");
function teamBrand(value) {
  const key = String(value || "").toLowerCase();
  return teams.find((team) => [team.slug, team.name, team.abbreviation].some((entry) => entry.toLowerCase() === key));
}
function logoPath(team) { return path.resolve(__dirname, "../../web", `.${team.logo}`); }
function brandTeamReply(payload, value, author = false) {
  const team = teamBrand(value);
  if (!team || !payload.embeds?.length) return payload;
  const name = `${team.slug}-logo.png`;
  const description=payload.embeds[0].data.description || "";
  if (teamEmoji(team.name)) {
    if (!description.includes(teamEmoji(team.name))) payload.embeds[0].setDescription(`${teamLabel(team.name)}\n${description}`.slice(0,4096));
    if (author) payload.embeds[0].setAuthor({ name: team.name });
    return payload;
  }
  if (author) payload.embeds[0].setAuthor({ name: team.name, iconURL: `attachment://${name}` });
  else payload.embeds[0].setThumbnail(`attachment://${name}`);
  return { ...payload, files: [...(payload.files || []), new AttachmentBuilder(logoPath(team), { name })] };
}
module.exports = { teamBrand, logoPath, brandTeamReply };
