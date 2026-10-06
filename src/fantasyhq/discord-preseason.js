const { addListFields } = require("../shared/discord-layout");
const { brandTeamReply } = require("../shared/team-branding");
const { EmbedBuilder } = require("discord.js");
const { nbaPlayerCard } = require("../shared/discord-player-card");

const { createPlayerService } = require("./player-service");
const { createSetupService } = require("./setup-service");
const { createTeamService } = require("./team-service");

const setupService = createSetupService();
const playerService = createPlayerService({ repository: setupService.repository });
const teamService = createTeamService({ repository: setupService.repository });

function positionLabel(player = {}) {
  return [player.position1, player.position2].filter(Boolean).join("/") || "N/A";
}

async function handlePlayerCommand(interaction) {
  const playerQuery = interaction.options.getString("player", true);
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const players = playerService.listPlayers(context.league.leagueId, context.seasonId);
  const normalized = playerQuery.trim().toLowerCase();
  const player = players.find((entry) => String(entry.playerId) === normalized)
    || players.find((entry) => String(entry.name || "").toLowerCase() === normalized)
    || players.find((entry) => String(entry.name || "").toLowerCase().includes(normalized));
  if (!player) throw new Error(`No player matched "${playerQuery}".`);

  await interaction.editReply(nbaPlayerCard(player, context.league.leagueName));
}

async function handleTeamsCommand(interaction) {
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const teams = teamService.listTeams(context.league.leagueId, context.seasonId);
  const lines = teams
    .sort((left, right) => left.conference.localeCompare(right.conference) || left.teamName.localeCompare(right.teamName))
    .map((team) => `${team.abbreviation} • ${team.teamName} • ${team.conference} • ${team.rosterSize} players${team.ownerUserId ? ` • <@${team.ownerUserId}>` : " • Unassigned"}`);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${context.league.leagueName} Teams`)
        .setColor(0xffdc21)
        .setDescription(lines.join("\n").slice(0, 4000)),
    ],
  });
}

async function handlePreseasonAutocomplete(interaction) {
  try {
    if (interaction.commandName !== "player") {
      await interaction.respond([]);
      return;
    }
    const focused = interaction.options.getFocused().toLowerCase();
    const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
    const choices = playerService.listPlayers(context.league.leagueId, context.seasonId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((player) => ({
        name: `${player.name} (${player.teamName || "Free Agent"}) · Age ${player.age ?? "—"} · TV ${Number(player.tradeValue || 1).toLocaleString("en-US")}`.slice(0, 100),
        value: player.playerId,
      }))
      .filter((choice) => !focused || choice.name.toLowerCase().includes(focused) || choice.value.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}

async function handleMyTeamCommand(interaction) {
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const teams = teamService.listTeams(context.league.leagueId, context.seasonId);
  const team = teams.find((entry) => entry.ownerUserId === interaction.user.id);
  if (!team) throw new Error("You don't have a team yet. Ask your commissioner to use /team assign.");
  const roster = team.roster.map((entry) => {
    const stats = entry.seasonStats;
    const averageLine = stats?.GP ? `${stats.GP} GP · ${stats.PPG.toFixed(1)} PPG · ${stats.RPG.toFixed(1)} RPG · ${stats.APG.toFixed(1)} APG` : "0 GP";
    return `**${entry.player?.name || "Unknown"}** · ${entry.player?.overall ?? "—"} OVR · ${entry.position1 || "—"}\nAge ${entry.player?.age ?? "—"} · Trade Value ${Number(entry.player?.tradeValue || 1).toLocaleString("en-US")} · ${averageLine}`;
  });
  const week = context.league.currentWeek || 1;
  const upcoming = team.schedule.filter((entry) => entry.week >= week).slice(0, 3);
  const embed = new EmbedBuilder().setTitle(team.teamName).setColor(0xffdc21)
    .setDescription(`${context.league.leagueName} · ${context.league.currentPhase.toLowerCase().replaceAll("_", " ")}\n<@${team.ownerUserId}> · ${team.rosterSize} players`);
  addListFields(embed, "Roster", roster.length ? roster : ["No roster imported yet."]);
  addListFields(embed, "Draft Picks", team.draftPicks.map(pick => `${pick.draftYear} ${pick.originalTeamAbbreviation} ${pick.round === 1 ? "1st" : "2nd"} · ${pick.protectionLabel} · Owner ${pick.currentOwnerTeamName} · Trade Value ${Number(pick.tradeValue).toLocaleString("en-US")}`));
  embed.addFields({ name: "Coming up", value: upcoming.map((entry) => `**Week ${entry.week}** · ${entry.bye ? "Bye" : `vs ${entry.opponent}`}`).join("\n") || "Schedule not confirmed yet." });
  embed.setFooter({ text: "/player for a profile · /schedule mine for all games" });
  await interaction.editReply(brandTeamReply({ embeds: [embed] }, team.teamName));
}

async function handleFreeAgentsCommand(interaction) {
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const position = interaction.options.getString("position");
  const players = playerService.listPlayers(context.league.leagueId, context.seasonId)
    .filter((player) => !player.teamId && (!position || [player.position1, player.position2].includes(position)))
    .sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0) || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(players.length / 15));
  const page = Math.min(interaction.options.getInteger("page") || 1, pages);
  const visible = players.slice((page - 1) * 15, page * 15);
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("League Free Agents").setColor(0xffdc21)
      .setDescription(visible.map((player) => `**${player.name}** · ${player.overall ?? "—"} OVR · ${positionLabel(player)} · Age ${player.age ?? "—"} · Trade Value ${Number(player.tradeValue || 1).toLocaleString("en-US")}`).join("\n\n") || "No free agents match. Ask your commissioner to run /roster freeagency if none have been imported.")
      .setFooter({ text: `Page ${page}/${pages} · ${players.length} players · Use /freeagents page to browse, /player for details.` })]
  });
}

module.exports = {
  handleMyTeamCommand,
  handleFreeAgentsCommand,
  handlePlayerCommand,
  handlePreseasonAutocomplete,
  handleTeamsCommand,
};
