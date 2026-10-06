const { teamLabel } = require("../shared/team-emojis");
const { addListFields } = require("../shared/discord-layout");
const { activeMemberships } = require("./service-helpers");
const { handleDeleteLeague } = require("./discord-delete-league");
const { roleOwnership } = require("./role-ownership");
const { brandTeamReply } = require("../shared/team-branding");
const { canManageLeague, requireLeagueStaff } = require("./discord-permissions");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require("discord.js");

const { ensureLeagueRoles } = require("./discord-roles");

const { PHASES } = require("./constants");
const { createSetupService } = require("./setup-service");
const { createPlayerStatsService } = require("./player-stats-service");
const { createPlayerService } = require("./player-service");

const setupService = createSetupService();
const playerService = createPlayerService({ repository: setupService.repository });
const playerStatsService = createPlayerStatsService({ repository: setupService.repository });
const channelSetup = require("./discord-channels").createChannelSetupService(setupService.repository);

const seasonStart = require("./discord-start-season").createDiscordSeasonStart({ repository: setupService.repository });
const requireAdmin = requireLeagueStaff;

function dashboardEmbed(dashboard) {
  const { league, totals, validator } = dashboard;
  const setup = league.currentPhase === PHASES.SETUP;
  const checks = validator.checks;
  const next = league.currentPhase === PHASES.PRESEASON ? "Review rosters, then click Start regular season below to validate and confirm Week 1." : !setup ? "Browse /myteam, /player, or /freeagents. Use the website for roster editing."
    : !checks.rostersImported ? "Run /roster import to load teams, players, and free agents."
      : !checks.ownersAssigned && dashboard.settings.requireAllOwners !== false ? "Assign owners with /team assign. For testing, /league settings can allow unassigned teams."
        : !checks.scheduleGenerated ? "Click Generate schedule below, review the preview, then click Confirm schedule."
          : validator.ready ? "Setup is complete. Enter preseason when you are ready."
            : "Resolve the setup issues below, then refresh this checklist.";
  const embed = new EmbedBuilder().setTitle(league.leagueName).setColor(0xffdc21)
    .setDescription(`Season ${league.seasonNumber} · ${league.currentPhase.toLowerCase().replaceAll("_", " ")}\n${totals.teams} teams · ${totals.players} players · ${totals.ownersAssigned}/${totals.teams} owners`)
    .addFields({ name: "Next step", value: next });
  if (setup) {
    embed.addFields({
      name: "Setup checklist", value: [
        `${require("./discord-channels").CHANNELS.every(([key]) => dashboard.settings.discordChannels?.[key]) ? "✓" : "○"} Discord channels configured`,
        `${checks.rostersImported ? "✓" : "○"} Rosters imported`,
        `${checks.ownersAssigned ? "✓" : "○"} Owners assigned`,
        `${checks.scheduleValid ? "✓" : "○"} Schedule confirmed`,
      ].join("\n")
    });
    if (validator.errors.length) embed.addFields({ name: "Needs attention", value: validator.errors.slice(0, 5).join("\n").slice(0, 1024) });
  }
  embed.addFields({ name: "Discord channel setup", value: "Create / repair channels sets up 17 lb- channels and league roles, repairs the Submit Trade, Trade Counts, Live Mock Draft and Player Upgrades pins, and applies coach/GM/staff/committee access. Existing channels keep their names and locations." });
  return embed;
}

function setupValidationEmbed(result) {
  return new EmbedBuilder()
    .setTitle("Setup Validation")
    .setColor(result.ready ? 0x2ecc71 : 0xe67e22)
    .addFields(
      { name: "Ready", value: result.ready ? "Yes" : "No", inline: true },
      { name: "Checks", value: Object.entries(result.checks).map(([key, value]) => `${key}: ${value ? "PASS" : "FAIL"}`).join("\n"), inline: false },
      { name: "Errors", value: result.errors.length ? result.errors.join("\n") : "None", inline: false },
      { name: "Warnings", value: result.warnings.length ? result.warnings.join("\n") : "None", inline: false },
    );
}

function ownersMap(leagueId) {
  return new Map(setupService.repository.loadOwners(leagueId).map((owner) => [owner.teamId, owner]));
}

async function handleLeagueCreate(interaction) {
  requireAdmin(interaction);
  const leagueId = interaction.options.getString("league_id", true);
  const leagueName = interaction.options.getString("league_name", true);
  const seasonNumber = interaction.options.getInteger("season_number") || 1;
  const testMode = interaction.options.getBoolean("test_mode") || false;

  const { league, imported, importError } = setupService.createLeagueWithRosters({
    testMode,
    leagueId,
    leagueName,
    seasonNumber,
    commissionerUserId: interaction.user.id,
    guildId: interaction.guildId,
  });

  let roleStatus;
  try {
    const roles = await ensureLeagueRoles(interaction.guild);
    roleStatus = `${roles.total} roles ready (${roles.created} created, ${roles.reused} reused). ${roles.iconsSupported ? "Team icons enabled." : "This server does not support role icons; logos still appear in the app."}${roles.warnings.length ? "\n" + roles.warnings.slice(0, 3).join("\n") : ""}`;
  } catch (error) {
    roleStatus = `League saved. ${error.message}`;
  }

  let channelStatus;
  try { const result = await channelSetup.ensure(interaction.guild, interaction.user.id); channelStatus = `${result.created} created, ${result.reused} reused, ${result.failed} failed. ${result.errors.slice(0, 2).join(' ')} Use /league setup → Create / repair channels to retry.`; }
  catch (error) { channelStatus = `${error.message} Retry from /league setup → Create / repair channels.`; }
  let ownerStatus = "Existing team-role holders become owners automatically. To start with vacant teams, remove their team roles in Discord.";
  if (imported) {
    try {
      const result = await roleOwnership.sync(interaction.guild);
      ownerStatus = `${result.owners}/30 owners found from existing team roles. ${ownerStatus}`;
      if (result.conflicts.length || result.warnings.length) ownerStatus += "\n" + [...result.conflicts, ...result.warnings].slice(0, 3).join("\n");
    } catch (error) { ownerStatus += `\nOwner sync needs attention: ${error.message}`; }
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("League Created")
        .setColor(0x2ecc71)
        .setDescription(`**${league.leagueName}** is ready for setup.`)
        .addFields(
          { name: "Discord roles", value: roleStatus },
          { name: "Discord channels", value: channelStatus.slice(0, 1024) },
          { name: "Players", value: imported ? `${imported.teamsImported} teams and ${imported.playersImported} players imported, including ${imported.freeAgentsImported} free agents.` : `League created, but import needs attention: ${importError}. Fix the source data and retry /roster import.` },
          { name: "Ownership", value: ownerStatus.slice(0, 1024) },
          { name: "Mode", value: testMode ? "Test league — unassigned teams are allowed." : "Full league — all 30 teams need owners before preseason." },
          { name: "Next step", value: imported ? "Open the checklist below. Assign team roles, then open the setup checklist and click Generate schedule." : "Retry /roster import after fixing the import issue. Do not recreate the league." },

        )
        .setFooter({ text: `Season ${league.seasonNumber} · ${league.leagueId}` }),
    ],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("setupflow:refresh").setLabel("Open setup checklist").setStyle(ButtonStyle.Primary))],
  });
}

async function handleLeagueStatus(interaction) {
  await roleOwnership.sync(interaction.guild);
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const dashboard = setupService.getSetupDashboard({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
  });
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("setupflow:refresh").setLabel("Refresh checklist").setStyle(ButtonStyle.Secondary));
  if (canManageLeague(interaction)) row.addComponents(new ButtonBuilder().setCustomId(`setupflow:channels:${context.league.leagueId}`).setLabel("Create / repair channels").setStyle(ButtonStyle.Secondary));
  if (context.league.currentPhase === PHASES.SETUP && canManageLeague(interaction)) {
    row.addComponents(new ButtonBuilder().setCustomId(`setupflow:schedule:${context.league.leagueId}`).setLabel("Generate schedule").setStyle(ButtonStyle.Primary).setDisabled(!dashboard.validator.checks.rostersImported || dashboard.validator.checks.scheduleValid));
    row.addComponents(new ButtonBuilder().setCustomId(`setupflow:activate:${context.league.leagueId}`).setLabel("Enter preseason").setStyle(ButtonStyle.Primary).setDisabled(!dashboard.validator.ready));
  }
  if (context.league.currentPhase === PHASES.PRESEASON && canManageLeague(interaction)) row.addComponents(new ButtonBuilder().setCustomId(`setupflow:startseason:${context.league.leagueId}`).setLabel("Start regular season").setStyle(ButtonStyle.Success));
  await interaction.editReply({ embeds: [dashboardEmbed(dashboard)], components: [row] });
}

async function handleLeagueSettings(interaction) {
  requireAdmin(interaction);
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const updates = {};

  const testMode = interaction.options.getBoolean("test_mode");
  const requireAllOwners = interaction.options.getBoolean("require_all_owners");
  const playoffTeams = interaction.options.getInteger("playoff_teams");
  const gameDeadlineHours = interaction.options.getInteger("game_deadline_hours");
  const resultConfirmationRequired = interaction.options.getBoolean("result_confirmation_required");
  const commissionerApprovalRequired = interaction.options.getBoolean("commissioner_approval_required");

  if (testMode != null) { updates.testMode = testMode; if (requireAllOwners == null) updates.requireAllOwners = !testMode; }
  if (requireAllOwners != null) updates.requireAllOwners = requireAllOwners;
  if (playoffTeams != null) updates.playoffTeams = playoffTeams;
  if (gameDeadlineHours != null) updates.gameDeadlineHours = gameDeadlineHours;
  if (resultConfirmationRequired != null) updates.resultConfirmationRequired = resultConfirmationRequired;
  if (commissionerApprovalRequired != null) updates.commissionerApprovalRequired = commissionerApprovalRequired;

  const settings = setupService.updateSettings({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
    actingUserId: interaction.user.id,
    updates,
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("League Settings Updated")
        .setColor(0x2ecc71)
        .setDescription("Your league preferences are saved.")
        .addFields(
          { name: "Mode", value: settings.testMode === true ? "🧪 Test Mode — staff solo controls enabled" : "Online league — normal permissions", inline: true },
          { name: "Owners", value: settings.requireAllOwners ? "All teams must be claimed" : "Vacant teams allowed", inline: true },
          { name: "Playoffs", value: `${settings.playoffTeams} teams`, inline: true },
          { name: "Game deadline", value: `${settings.gameDeadlineHours} hours`, inline: true },
          { name: "Result checks", value: [settings.resultConfirmationRequired ? "Opponent confirmation required" : "No opponent confirmation", settings.commissionerApprovalRequired ? "Commissioner approval required" : "No commissioner approval"].join("\n") },
        ),
    ],
  });
}

async function handleRosterImport(interaction) {
  requireAdmin(interaction);
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const result = setupService.importRosters({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
    actingUserId: interaction.user.id,
  });
  await roleOwnership.sync(interaction.guild);
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Rosters Imported")
        .setColor(0x2ecc71)
        .setDescription(`Imported ${result.teamsImported} teams and ${result.playersImported} players into LEAGUEbuddy.`),
    ],
  });
}

async function handleRosterStatus(interaction) {
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const teams = context.teams;
  const memberships = setupService.repository.loadRosterMemberships(context.league.leagueId)
    .filter((entry) => String(entry.seasonId) === String(context.seasonId));
  const rosteredTeams = new Set(memberships.map((entry) => entry.teamId));
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Roster Status")
        .setColor(0xffdc21)
        .setDescription(`Imported rosters: ${rosteredTeams.size}/${teams.length}`)
        .addFields({
          name: "Missing",
          value: teams.filter((team) => !rosteredTeams.has(team.teamId)).map((team) => team.teamName).join("\n") || "None",
        }),
    ],
  });
}

async function handleTeamList(interaction) {
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const ownerLookup = ownersMap(context.league.leagueId);
  const embed = new EmbedBuilder().setTitle("Team directory").setColor(0xffdc21)
    .setDescription(`${context.league.leagueName} · ${ownerLookup.size}/${context.teams.length} teams claimed`);
  for (const conference of ["East", "West"]) {
    const lines = context.teams.filter((team) => team.conference === conference)
      .sort((a, b) => a.teamName.localeCompare(b.teamName))
      .map((team) => `**${teamLabel(team.teamName)}** · ${ownerLookup.has(team.teamId) ? `<@${ownerLookup.get(team.teamId).userId}>` : "Open"}`);
    addListFields(embed, conference, lines);
  }
  await interaction.editReply({ embeds: [embed] });
}

async function handleTeamRoster(interaction) {
  const teamQuery = interaction.options.getString("team", true);
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const team = context.teams.find((entry) => entry.teamId === teamQuery || entry.teamName === teamQuery);
  if (!team) throw new Error(`No team matched "${teamQuery}".`);
  const players = playerService.listPlayers(context.league.leagueId, context.seasonId);
  const memberships = activeMemberships(setupService.repository.loadRosterMemberships(context.league.leagueId), context.seasonId)
    .filter((entry) => entry.teamId === team.teamId);
  const playerMap = new Map(players.map((player) => [player.playerId, player]));
  const statsByPlayerId = new Map(playerStatsService.getSeasonPlayerStats(context.league.leagueId, context.seasonId).map(stats => [stats.playerId, stats]));
  const lines = memberships.map((membership) => {
    const player = playerMap.get(membership.playerId);
    const stats = statsByPlayerId.get(membership.playerId);
    const averageLine = stats?.GP ? `${stats.GP} GP · ${stats.PPG.toFixed(1)} PPG · ${stats.RPG.toFixed(1)} RPG · ${stats.APG.toFixed(1)} APG` : "0 GP";
    return `**${player?.name || "Unknown player"}** · ${player?.overall ?? "—"} OVR · ${[membership.position1, membership.position2].filter(Boolean).join("/") || "—"}${membership.jerseyNumber != null ? ` · #${membership.jerseyNumber}` : ""}\nAge ${player?.age ?? "—"} · Trade Value ${Number(player?.tradeValue || 1).toLocaleString("en-US")} · ${averageLine}`;
  });
  const embed = new EmbedBuilder().setTitle(`${team.teamName} Roster`).setColor(0xffdc21);
  addListFields(embed, "Players", lines.length ? lines : ["No players found."]);
  await interaction.editReply(brandTeamReply({
    embeds: [embed],
  }, team.teamName));
}

async function handleTeamAssign(interaction) {
  requireAdmin(interaction);
  const teamId = interaction.options.getString("team", true);
  const userId = interaction.options.getUser("user", true).id;
  const result = await roleOwnership.setOwner(interaction.guild, teamId, userId);
  await interaction.editReply(`${userId ? `Assigned <@${userId}>` : "Removed the owner"} for ${teamId}. Team roles and league ownership are synced.${result.conflicts.length || result.warnings.length ? "\n" + [...result.conflicts, ...result.warnings].slice(0, 5).join("\n") : ""}`);
}

async function handleTeamUnassign(interaction) {
  requireAdmin(interaction);
  const teamId = interaction.options.getString("team", true);
  const userId = null;
  const result = await roleOwnership.setOwner(interaction.guild, teamId, userId);
  await interaction.editReply(`${userId ? `Assigned <@${userId}>` : "Removed the owner"} for ${teamId}. Team roles and league ownership are synced.${result.conflicts.length || result.warnings.length ? "\n" + [...result.conflicts, ...result.warnings].slice(0, 5).join("\n") : ""}`);
}

async function handleSetupValidate(interaction) {
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const result = setupService.validateSetup({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
  });
  await interaction.editReply({ embeds: [setupValidationEmbed(result)] });
}

async function handleSetupActivate(interaction) {
  requireAdmin(interaction);
  await roleOwnership.sync(interaction.guild);
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const league = setupService.activateLeague({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
    actingUserId: interaction.user.id,
  });
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("League Activated")
        .setColor(0x2ecc71)
        .setDescription(`**${league.leagueName}** moved from SETUP to **${league.currentPhase.toLowerCase().replaceAll("_", " ")}**.`),
    ],
  });
}

async function handleLeagueCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "delete") return handleDeleteLeague(interaction);
  if (subcommand === "roles") {
    requireAdmin(interaction);
    const result = await ensureLeagueRoles(interaction.guild);
    await roleOwnership.sync(interaction.guild);
    await interaction.editReply(`All ${result.total} league roles are ready: ${result.created} created, ${result.reused} reused. Includes 30 NBA teams, LEAGUEbuddy Coach, LEAGUEbuddy GM, LEAGUEbuddy Commish, LEAGUEbuddy Assistant Commish, and LEAGUEbuddy Trade Committee. ${result.iconsSupported ? "Team role icons enabled." : "Role icons are not supported by this server; app logos still work."}${result.warnings.length ? "\n" + result.warnings.slice(0, 5).join("\n") : ""}`);
    return;
  }
  if (subcommand === "create") return handleLeagueCreate(interaction);
  if (subcommand === "status") return handleLeagueStatus(interaction);
  if (subcommand === "setup") return handleLeagueStatus(interaction);
  if (subcommand === "settings") return handleLeagueSettings(interaction);
  throw new Error(`Unsupported league subcommand "${subcommand}".`);
}

async function handleRosterCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "freeagency") {
    requireAdmin(interaction);
    const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
    const result = setupService.importFreeAgents({ leagueId: context.league.leagueId, seasonId: context.seasonId, actingUserId: interaction.user.id });
    await interaction.editReply(`Imported ${result.imported} free agents. Skipped ${result.skipped} existing or invalid entries.`);
    return;
  }
  if (subcommand === "import") return handleRosterImport(interaction);
  if (subcommand === "status") return handleRosterStatus(interaction);
  throw new Error(`Unsupported roster subcommand "${subcommand}".`);
}

async function handleTeamCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "list") return handleTeamList(interaction);
  if (subcommand === "roster") return handleTeamRoster(interaction);
  if (subcommand === "assign") return handleTeamAssign(interaction);
  if (subcommand === "unassign") return handleTeamUnassign(interaction);
  throw new Error(`Unsupported team subcommand "${subcommand}".`);
}

async function handleSetupCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "validate") return handleSetupValidate(interaction);
  if (subcommand === "activate") return handleSetupActivate(interaction);
  throw new Error(`Unsupported setup subcommand "${subcommand}".`);
}

async function handleSetupAutocomplete(interaction) {
  try {
    const command = interaction.commandName;
    if (!["team"].includes(command)) {
      await interaction.respond([]);
      return;
    }

    const focused = interaction.options.getFocused().toLowerCase();
    const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
    const choices = context.teams
      .map((team) => ({
        name: `${team.teamName} (${team.abbreviation})`.slice(0, 100),
        value: team.teamId,
      }))
      .filter((choice) => !focused || choice.name.toLowerCase().includes(focused) || choice.value.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}

async function handleSetupFlowButton(interaction, service = setupService) {
  if (/^setupflow:(startseason|startconfirm|startcancel):/.test(interaction.customId)) return seasonStart.handle(interaction);
  if (interaction.customId === "setupflow:refresh") return handleLeagueStatus(interaction);
  requireAdmin(interaction);
  const context = service.getLeagueContextByBinding({ guildId: interaction.guildId });
  if (interaction.customId === `setupflow:schedule:${context.league.leagueId}`) {
    if (context.league.currentPhase !== PHASES.SETUP) throw new Error("Schedule setup is only available during SETUP.");
    if (service.getSetupDashboard({ leagueId: context.league.leagueId, seasonId: context.seasonId }).validator.checks.scheduleValid) return handleLeagueStatus(interaction);
    const pending = service.getPendingSchedule({ leagueId: context.league.leagueId });
    const preview = pending?.schedule?.seasonId === context.seasonId ? pending : service.generatePendingSchedule({ leagueId: context.league.leagueId, seasonId: context.seasonId, actingUserId: interaction.user.id });
    await interaction.editReply(require("./discord-schedule").previewPayload(context, preview));
    return;
  }
  if (interaction.customId === `setupflow:channels:${context.league.leagueId}`) {
    const result = await channelSetup.ensure(interaction.guild, interaction.user.id);
    await interaction.editReply({ content: `Discord channels: ${result.created} created, ${result.reused} reused, ${result.failed} failed.\n${result.errors.slice(0, 5).join('\n')}\nSaved channel assignments. Live Mock Draft: ${result.liveMockMessageId ? `https://discord.com/channels/${interaction.guildId}/${result.liveMockChannelId}/${result.liveMockMessageId}` : 'not verified; check repair errors above'}. Coach, GM, and Trade Committee roles are ready; assign reviewers in Discord.`, embeds: [], components: [] });
    return;
  }
  if (interaction.customId !== `setupflow:activate:${context.league.leagueId}`) throw new Error("The active league changed. Open /league setup again.");
  return handleSetupActivate(interaction);
}

module.exports = {
  handleSetupFlowButton,
  handleLeagueCommand,
  handleRosterCommand,
  handleSetupAutocomplete,
  handleSetupCommand,
  handleTeamCommand,
};
