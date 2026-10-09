const { roleOwnership } = require("./role-ownership");
const { canManageLeague, requireLeagueStaff } = require("./discord-permissions");
const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");

const { createSetupService } = require("./setup-service");

const setupService = createSetupService();
const repository = setupService.repository;

const assertAdmin = requireLeagueStaff;

function bindingStatusEmbed(guildId) {
  const binding = repository.loadGuildLeagueBinding(guildId);
  if (!binding) {
    return new EmbedBuilder()
      .setTitle("LEAGUEbuddy League Status")
      .setColor(0xe67e22)
      .setDescription("No league is currently bound to this Discord server.")
      .addFields({
        name: "Next Step",
        value: "Run `/league create`, then `/roster import` to set up a league.",
      });
  }

  const context = repository.loadLeague(binding.leagueId, binding.seasonId);
  const hasSchedule = repository.scheduleExists(binding.leagueId, binding.seasonId);
  return new EmbedBuilder()
    .setTitle("LEAGUEbuddy League Status")
    .setColor(0xffdc21)
    .addFields(
      { name: "League", value: context.league.name, inline: true },
      { name: "League ID", value: context.league.leagueId, inline: true },
      { name: "Season", value: context.seasonId, inline: true },
      { name: "Teams", value: String(context.teams.length), inline: true },
      { name: "Schedule", value: hasSchedule ? "Saved" : "Not generated yet", inline: true },
      { name: "Guild Bound", value: guildId ? "Yes" : "No", inline: true },
    );
}

async function handleAdminBootstrap(interaction) {
  assertAdmin(interaction);

  const leagueId = interaction.options.getString("league_id", true);
  const seasonId = interaction.options.getString("season_id") || "2026";
  const leagueName = interaction.options.getString("league_name") || "LEAGUEbuddy MyNBA League";
  const league = setupService.createLeague({
    leagueId,
    leagueName,
    seasonNumber: Number(seasonId) || 2026,
    commissionerUserId: interaction.user.id,
    guildId: interaction.guildId,
  });
  const result = setupService.importRosters({
    leagueId,
    seasonId,
    actingUserId: interaction.user.id,
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("LEAGUEbuddy League Bootstrapped")
        .setColor(0x2ecc71)
        .setDescription("Created league files from the latest 2KRatings roster snapshot and bound them to this server.")
        .addFields(
          { name: "League", value: league.name, inline: true },
          { name: "League ID", value: leagueId, inline: true },
          { name: "Season", value: seasonId, inline: true },
          { name: "Teams Imported", value: String(result.teamsImported), inline: true },
        ),
    ],
  });
}

async function handleAdminBind(interaction) {
  assertAdmin(interaction);

  const leagueId = interaction.options.getString("league_id", true);
  const seasonId = interaction.options.getString("season_id");
  const context = repository.loadLeague(leagueId, seasonId);
  repository.saveGuildLeagueBinding(interaction.guildId, {
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
  });

  let syncNote;
  try {
    const result = await roleOwnership.sync(interaction.guild);
    syncNote = `${result.owners} owners synced from team roles.${result.conflicts.length ? " Resolve duplicate team assignments in Discord." : ""}`;
  } catch (error) { syncNote = `Binding saved. Ownership sync needs attention: ${error.message}. Automatic sync will retry.`; }
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("League Bound")
        .setColor(0x2ecc71)
        .setDescription(`This server now uses **${context.league.name}** for schedule commands.`)
        .addFields(
          { name: "Ownership", value: syncNote.slice(0, 1024) },
          { name: "League ID", value: context.league.leagueId, inline: true },
          { name: "Season", value: context.seasonId, inline: true },
        ),
    ],
  });
}

async function handleAdminSeason(interaction) {
  assertAdmin(interaction);

  const seasonId = interaction.options.getString("season_id", true);
  const binding = repository.loadGuildLeagueBinding(interaction.guildId);
  if (!binding?.leagueId) {
    throw new Error("No league is bound to this server yet. Run `/league create` or `/admin bind` first.");
  }

  const current = repository.loadLeague(binding.leagueId, binding.seasonId);
  repository.saveLeague(binding.leagueId, {
    name: current.league.name,
    currentSeasonId: seasonId,
  });
  repository.saveGuildLeagueBinding(interaction.guildId, {
    leagueId: binding.leagueId,
    seasonId,
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Season Updated")
        .setColor(0x2ecc71)
        .setDescription(`Schedule commands for this server now target season **${seasonId}**.`),
    ],
  });
}

async function handleAdminStatus(interaction) {
  assertAdmin(interaction);
  await interaction.editReply({ embeds: [bindingStatusEmbed(interaction.guildId)] });
}

async function handleAdminCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "bootstrap") return handleAdminBootstrap(interaction);
  if (subcommand === "bind") return handleAdminBind(interaction);
  if (subcommand === "season") return handleAdminSeason(interaction);
  if (subcommand === "status") return handleAdminStatus(interaction);
  throw new Error(`Unsupported admin subcommand "${subcommand}".`);
}

module.exports = {
  handleAdminCommand,
};
