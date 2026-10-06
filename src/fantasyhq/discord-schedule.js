const {teamLabel}=require("../shared/team-emojis");
const { weekCard, teamScheduleCard } = require("../shared/discord-layout");
const { brandTeamReply } = require("../shared/team-branding");
const { canManageLeague, requireLeagueStaff } = require("./discord-permissions");
const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");

const { createSetupService } = require("./setup-service");
const {
  findTeamByQuery,
  formatFullScheduleText,
  formatTeamScheduleText,
  formatWeekText,
  summarizeSchedule,
} = require("./schedule-formatters");

const setupService = createSetupService();

const requireScheduleAdmin = requireLeagueStaff;
function setupReturnRow() { return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("setupflow:refresh").setLabel("Back to setup").setStyle(ButtonStyle.Secondary)); }

function previewPayload(context, pending, requestedPage = 0) {
  const weeks = pending.schedule.weeks;
  if (!weeks.length) throw new Error("This preview has no weeks. Generate a new schedule.");
  const page = Math.max(0, Math.min(weeks.length - 1, Number.isFinite(Number(requestedPage)) ? Math.trunc(Number(requestedPage)) : 0));
  const week = weeks[page];
  const teamNames = new Map(context.teams.map((team) => [team.teamId, team.teamName]));
  const name = (id) => teamLabel(teamNames.get(id) || id);
  const summary = summarizeSchedule(pending.schedule);
  const embed = new EmbedBuilder()
    .setTitle(`${context.league.name} • Week ${week.week}`)
    .setColor(0xffdc21)
    .setDescription(`Schedule preview • Season ${pending.schedule.seasonId}\n${summary.weekCount} weeks · ${summary.totalGames} games · 14 games and 1 bye per team`);
  for (const conference of ["East", "West"]) {
    const games = week.games.filter((game) => game.conference === conference)
      .map((game) => `**${name(game.team1Id)}** vs ${name(game.team2Id)}`);
    const byes = week.byes.filter((bye) => bye.conference === conference).map((bye) => name(bye.teamId));
    embed.addFields({ name: `${conference} Conference`, value: `${games.join("\n") || "No games"}\n\n**Bye:** ${byes.join(", ") || "None"}` });
  }
  embed.setFooter({ text: `Week ${page + 1} of ${weeks.length} • Preview only — confirm to save all weeks.` });
  const button = (action, label, style, target = page) => new ButtonBuilder()
    .setCustomId(`schedule:preview:${action}:${pending.pendingScheduleId}:${target}:${label.toLowerCase().replaceAll(" ", "-")}`).setLabel(label).setStyle(style);
  return { embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      button("page", "First", ButtonStyle.Secondary, 0).setDisabled(page === 0),
      button("page", "Previous", ButtonStyle.Primary, page - 1).setDisabled(page === 0),
      button("page", "Next", ButtonStyle.Primary, page + 1).setDisabled(page === weeks.length - 1),
      button("page", "Last", ButtonStyle.Secondary, weeks.length - 1).setDisabled(page === weeks.length - 1),
    ),
    new ActionRowBuilder().addComponents(
      button("confirm", "Confirm schedule", ButtonStyle.Success),
      button("regenerate", "Regenerate", ButtonStyle.Secondary),
      button("cancel", "Cancel", ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("setupflow:refresh").setLabel("Back to setup").setStyle(ButtonStyle.Secondary),
    ),
  ] };
}

function savedEmbed(context, schedule) {
  return new EmbedBuilder()
    .setTitle(`${context.league.name} Schedule Saved`)
    .setColor(0x2ecc71)
    .setDescription(`Saved the ${schedule.seasonId} schedule for ${context.teams.length} teams.`)
    .setFooter({ text: `League ${schedule.leagueId}` });
}

function scheduleTextAttachment(fileName, content) {
  return new AttachmentBuilder(Buffer.from(`${content}\n`, "utf8"), { name: fileName });
}

async function handleScheduleGenerate(interaction) {
  requireScheduleAdmin(interaction);
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const pending = setupService.generatePendingSchedule({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
    actingUserId: interaction.user.id,
  });
  await interaction.editReply(previewPayload(context, pending));
}

async function handleSchedulePreview(interaction) {
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const pending = setupService.getPendingSchedule({ leagueId: context.league.leagueId });
  if (!pending?.schedule) throw new Error("No pending schedule preview exists. Run /schedule generate first.");
  await interaction.editReply(previewPayload(context, pending));
}

async function handleScheduleConfirm(interaction) {
  requireScheduleAdmin(interaction);
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const saved = setupService.confirmPendingSchedule({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
    actingUserId: interaction.user.id,
  });
  await interaction.editReply({
    embeds: [savedEmbed(context, saved)],
    components: [],
  });
}

async function handleScheduleRegenerate(interaction) {
  requireScheduleAdmin(interaction);
  await handleScheduleGenerate(interaction);
}

async function handleScheduleWeek(interaction) {
  const weekNumber = interaction.options.getInteger("week") || 1;
  const context = setupService.repository.loadLeagueContext({ guildId: interaction.guildId });
  const schedule = setupService.repository.loadScheduleContext({ guildId: interaction.guildId, seasonId: context.seasonId });
  await interaction.editReply({ embeds: [weekCard(context, schedule, weekNumber)] });
}

async function handleScheduleTeam(interaction) {
  const teamQuery = interaction.options.getString("team", true);
  const context = setupService.repository.loadLeagueContext({ guildId: interaction.guildId });
  const team = findTeamByQuery(context.teams, teamQuery);
  if (!team) throw new Error(`No team matched "${teamQuery}".`);

  const schedule = setupService.repository.loadScheduleContext({ guildId: interaction.guildId, seasonId: context.seasonId });
  await interaction.editReply(brandTeamReply({ embeds: [teamScheduleCard(context, schedule, team)] }, team.teamName));
}

async function handleScheduleMine(interaction) {
  const context = setupService.repository.loadLeagueContext({ guildId: interaction.guildId });
  const owner = setupService.repository.loadOwners(context.league.leagueId)
    .find((entry) => entry.userId === interaction.user.id);
  if (!owner) {
    throw new Error("You do not currently own a team in this league.");
  }
  const team = context.teams.find((entry) => entry.teamId === owner.teamId);
  if (!team) {
    throw new Error("Your assigned team could not be found.");
  }

  const schedule = setupService.repository.loadScheduleContext({ guildId: interaction.guildId, seasonId: context.seasonId });
  await interaction.editReply(brandTeamReply({ embeds: [teamScheduleCard(context, schedule, team)] }, team.teamName));
}

async function handleScheduleFull(interaction) {
  const context = setupService.repository.loadLeagueContext({ guildId: interaction.guildId });
  const schedule = setupService.repository.loadScheduleContext({ guildId: interaction.guildId, seasonId: context.seasonId });
  const text = formatFullScheduleText(schedule, context.teams);
  const summary = summarizeSchedule(schedule);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${context.league.name} Full Schedule`)
        .setColor(0xffdc21)
        .setDescription(`${summary.weekCount} weeks • ${summary.totalGames} games • Season ${schedule.seasonId}`),
    ],
    files: [scheduleTextAttachment(`schedule-${schedule.leagueId}-${schedule.seasonId}.txt`, text)],
  });
}

async function handleScheduleCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "generate") return handleScheduleGenerate(interaction);
  if (subcommand === "preview") return handleSchedulePreview(interaction);
  if (subcommand === "confirm") return handleScheduleConfirm(interaction);
  if (subcommand === "regenerate") return handleScheduleRegenerate(interaction);
  if (subcommand === "mine") return handleScheduleMine(interaction);
  if (subcommand === "week") return handleScheduleWeek(interaction);
  if (subcommand === "team") return handleScheduleTeam(interaction);
  if (subcommand === "full") return handleScheduleFull(interaction);
  throw new Error(`Unsupported schedule subcommand "${subcommand}".`);
}

async function handleScheduleButton(interaction) {
  const [, , action, pendingId, page] = interaction.customId.split(":");
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const leagueId = context.league.leagueId;
  const pending = setupService.getPendingSchedule({ leagueId });
  if (!pending?.schedule || pending.pendingScheduleId !== pendingId) {
    await interaction.reply({ content: "That preview was replaced or closed. Use /schedule preview for the current preview, or /schedule generate for a new one.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "page") {
    await interaction.update(previewPayload(context, pending, page));
    return;
  }

  if (action === "cancel") {
    requireScheduleAdmin(interaction);
    setupService.clearPendingSchedule({ leagueId, actingUserId: interaction.user.id });
    await interaction.update({
      content: "Schedule generation canceled.",
      embeds: [],
      components: [setupReturnRow()],
    });
    return;
  }

  if (action === "regenerate") {
    requireScheduleAdmin(interaction);
    const nextPending = setupService.generatePendingSchedule({
      leagueId,
      seasonId: context.seasonId,
      actingUserId: interaction.user.id,
    });
    await interaction.update(previewPayload(context, nextPending));
    return;
  }

  if (action === "confirm") {
    requireScheduleAdmin(interaction);
    const savedSchedule = setupService.confirmPendingSchedule({
      leagueId,
      seasonId: context.seasonId,
      actingUserId: interaction.user.id,
    });
    await interaction.update({
      embeds: [savedEmbed(context, savedSchedule)],
      components: [setupReturnRow()],
    });
    return;
  }

  await interaction.reply({ content: "Unknown schedule action.", flags: MessageFlags.Ephemeral });
}

async function handleScheduleAutocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused().toLowerCase();
    const context = setupService.repository.loadLeagueContext({ guildId: interaction.guildId });
    const choices = context.teams
      .map((team) => ({
        name: `${team.teamName} (${team.abbreviation})`.slice(0, 100),
        value: team.teamName,
      }))
      .filter((choice) => !focused || choice.name.toLowerCase().includes(focused) || choice.value.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}

module.exports = {
  previewPayload,
  handleScheduleAutocomplete,
  handleScheduleButton,
  handleScheduleCommand,
};
