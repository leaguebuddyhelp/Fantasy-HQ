const { contractView } = require('../shared/player-contract');
const { brandTeamReply } = require("../shared/team-branding");
const { addListFields } = require("../shared/discord-layout");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const { nbaPlayerCard } = require("../shared/discord-player-card");

const {
  findPlayer,
  latestSnapshot,
  loadFreeAgency,
  loadTeamRoster,
  loadTeams,
  normalizeText,
  topFreeAgents,
  topPlayers,
} = require("./repository");

function positionLabel(player = {}) {
  return [player.position1, player.position2].filter(Boolean).join("/") || "N/A";
}

function playerSummaryLine(player = {}, index = null) {
  const prefix = index == null ? "" : `${index + 1}. `;
  return `${prefix}**${player.name}** · ${player.overall ?? "—"} OVR · ${positionLabel(player)}\n${player.team || "Free agent"}`;
}

function linesAttachment(fileName, title, lines) {
  const body = [title, "", ...lines].join("\n");
  return new AttachmentBuilder(Buffer.from(`${body}\n`, "utf8"), { name: fileName });
}

function cappedLimit(interaction, fallback = 10) {
  return Math.max(1, Math.min(25, interaction.options.getInteger("limit") || fallback));
}

async function handleRatingsTeam(interaction) {
  const teamQuery = interaction.options.getString("team", true);
  const roster = loadTeamRoster(teamQuery);
  if (!roster) throw new Error(`No roster matched "${teamQuery}".`);

  const lines = [...roster.players].sort((a,b)=>Number(b.overall || 0)-Number(a.overall || 0))
    .map((player) => `**${player.name}** · ${player.overall ?? "—"} OVR · ${positionLabel(player)} · ${contractView(player).short}`);
  const embed = new EmbedBuilder().setTitle(`${roster.team.name} • Ratings`).setColor(0xffdc21)
    .setDescription(`${roster.players.length} players · Reference snapshot · Use /team roster for the current league roster`)
    .setFooter({ text: `2KRatings · ${roster.rosterDate || "Date unavailable"}` });
  addListFields(embed, "Roster", lines);
  await interaction.editReply(brandTeamReply({ embeds: [embed] }, roster.team.name));
}

async function handleRatingsPlayer(interaction) {
  const playerQuery = interaction.options.getString("player", true);
  const player = findPlayer(playerQuery);
  if (!player) throw new Error(`No player matched "${playerQuery}".`);
  await interaction.editReply(nbaPlayerCard(player, "Reference ratings snapshot · Use /player for current league details"));
}

async function handleRatingsTop(interaction) {
  const limit = cappedLimit(interaction, 10);
  const position = interaction.options.getString("position");
  const players = topPlayers({ limit, position, includeFreeAgency: false });
  const rosterDate = latestSnapshot().rosterDate || "Unknown";
  const title = position ? `Top ${players.length} ${position} Players` : `Top ${players.length} Players`;
  const lines = players.map((player, index) => playerSummaryLine(player, index));

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Reference ratings · ${title}`)
        .setColor(0xffdc21)
        .setDescription(lines.join("\n\n") || "No players found.")
        .setFooter({ text: `Snapshot: ${rosterDate} · /player shows current league details` }),
    ],
  });
}

async function handleRatingsFreeAgency(interaction) {
  const freeAgency = loadFreeAgency();
  if (!freeAgency) throw new Error("No free agency snapshot is available yet.");

  const limit = cappedLimit(interaction, 15);
  const position = interaction.options.getString("position");
  const players = topFreeAgents({ limit, position });
  const title = position ? `Top Free Agents • ${position}` : "Top Free Agents";
  const lines = players.map((player, index) => playerSummaryLine(player, index));

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Reference ratings · ${title}`)
        .setColor(0xffdc21)
        .setDescription(lines.join("\n") || "No free agents found.")
        .setFooter({ text: `Snapshot: ${freeAgency.rosterDate || "Unknown"} · /freeagents shows current availability` }),
    ],
  });
}

async function handleRatingsCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "team") return handleRatingsTeam(interaction);
  if (subcommand === "player") return handleRatingsPlayer(interaction);
  if (subcommand === "top") return handleRatingsTop(interaction);
  if (subcommand === "freeagency") return handleRatingsFreeAgency(interaction);
  throw new Error(`Unsupported ratings subcommand "${subcommand}".`);
}

async function handleRatingsAutocomplete(interaction) {
  try {
    const subcommand = interaction.options.getSubcommand();
    const focused = normalizeText(interaction.options.getFocused());

    if (subcommand === "team") {
      const choices = loadTeams()
        .map((team) => ({ name: team.name.slice(0, 100), value: team.name }))
        .filter((choice) => !focused || normalizeText(choice.name).includes(focused))
        .slice(0, 25);
      await interaction.respond(choices);
      return;
    }

    if (subcommand === "player") {
      const teams = loadTeams();
      const players = teams.flatMap((team) => {
        const roster = loadTeamRoster(team.name);
        return roster?.players || [];
      });
      const freeAgency = loadFreeAgency();
      const merged = [...players, ...(freeAgency?.players || [])];
      const seen = new Set();
      const choices = merged
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((player) => {
          const key = normalizeText(player.name);
          if (seen.has(key)) return false;
          seen.add(key);
          return !focused || key.includes(focused);
        })
        .slice(0, 25)
        .map((player) => ({
          name: `${player.name} (${player.team})`.slice(0, 100),
          value: player.name,
        }));
      await interaction.respond(choices);
      return;
    }

    await interaction.respond([]);
  } catch {
    await interaction.respond([]);
  }
}

module.exports = {
  handleRatingsAutocomplete,
  handleRatingsCommand,
};
