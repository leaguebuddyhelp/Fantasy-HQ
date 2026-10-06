const {teamLabel}=require("./team-emojis");
const { EmbedBuilder } = require("discord.js");

function addListFields(embed, title, lines, inline = false) {
  let chunk = [];
  let count = 0;
  for (const line of lines) {
    if (chunk.length && [...chunk, line].join("\n").length > 1000) {
      embed.addFields({ name: count++ ? `${title} continued` : title, value: chunk.join("\n"), inline });
      chunk = [];
    }
    chunk.push(line);
  }
  if (chunk.length) embed.addFields({ name: count ? `${title} continued` : title, value: chunk.join("\n"), inline });
  return embed;
}

function weekCard(context, schedule, weekNumber) {
  const week = schedule.weeks.find((entry) => entry.week === weekNumber);
  if (!week) throw new Error(`Week ${weekNumber} was not found.`);
  const names = new Map(context.teams.map((team) => [team.teamId, team.teamName]));
  const name = (id) => teamLabel(names.get(id) || id);
  const embed = new EmbedBuilder().setTitle(`Week ${weekNumber} • ${context.league.name}`)
    .setColor(0xffdc21).setDescription(`Season ${schedule.seasonId} · ${week.games.length} games`);
  for (const conference of ["East", "West"]) {
    const lines = week.games.filter((game) => game.conference === conference)
      .map((game) => `**${name(game.team1Id)}** vs ${name(game.team2Id)}`);
    lines.push(`\n**Bye** · ${week.byes.filter((bye) => bye.conference === conference).map((bye) => name(bye.teamId)).join(", ") || "None"}`);
    addListFields(embed, conference, lines);
  }
  return embed;
}

function teamScheduleCard(context, schedule, team) {
  const names = new Map(context.teams.map((entry) => [entry.teamId, entry.teamName]));
  const embed = new EmbedBuilder().setTitle(`${team.teamName} • Schedule`).setColor(0xffdc21)
    .setDescription(`Season ${schedule.seasonId} · ${schedule.weeks.length} weeks`);
  const lines = schedule.weeks.map((week) => {
    const game = week.games.find((entry) => [entry.team1Id, entry.team2Id].includes(team.teamId));
    const opponent = game && (game.team1Id === team.teamId ? game.team2Id : game.team1Id);
    return `**Week ${week.week}** · ${game ? `vs ${teamLabel(names.get(opponent) || opponent)}` : "Rest week — bye"}`;
  });
  for (let start = 0; start < lines.length; start += 5) addListFields(embed, `Weeks ${start + 1}–${Math.min(start + 5, lines.length)}`, lines.slice(start, start + 5));
  return embed;
}
module.exports = { addListFields, weekCard, teamScheduleCard };
