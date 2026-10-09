const { addListFields } = require("../shared/discord-layout");
const { brandTeamReply } = require("../shared/team-branding");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { nbaPlayerCard } = require("../shared/discord-player-card");

const { createPlayerService } = require("./player-service");
const { createSetupService } = require("./setup-service");
const { createTeamService } = require("./team-service");

const setupService = createSetupService();
const playerService = createPlayerService({ repository: setupService.repository });
const teamService = createTeamService({ repository: setupService.repository, publishedOnly: true, playerStatsService: require("./player-stats-service").createPlayerStatsService({ repository: setupService.repository, publishedOnly: true }) });

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
  const identity = require('./coach-identity').requireCoachIdentity(setupService.repository, context, interaction.member, interaction.user.id);
  const team = teams.find((entry) => entry.teamId === identity.teamId);
  if (!team) throw new Error("You don't have a team yet. Ask your commissioner to use /team assign.");
  const fa = require('./free-agency-service').createFreeAgencyService({ repository: setupService.repository });
  let faStatus = fa.getStatus(context.league.leagueId, team.teamId);
  if (context.league.currentPhase === 'FREE_AGENCY') {
    const market = require('./offseason-free-agency').createOffseasonFreeAgencyService({repository:setupService.repository}).inspect(context.league.leagueId,{id:interaction.user.id},{teamId:team.teamId});
    faStatus = {offseason:true,completedSignings:market.limits.openSignings,activeTargets:market.limits.activeOffers,allowedActiveTargets:5,stageName:market.stage?.name||'Waiting for Staff'};
  }
  context.offseasonStep = setupService.repository.loadOffseason(context.league.leagueId)?.seasons[context.seasonId]?.step;
  await interaction.editReply(myTeamPayload(team, context, faStatus));
}

function myTeamPayload(team, context, faStatus = { completedSignings: 0, activeTargets: 0, allowedActiveTargets: 2 }) {
  const { compactDollars } = require("../shared/player-contract");
  const roster = team.roster || [];
  const week = context.league.currentWeek || 1;
  const phase = String(context.league.currentPhase || "Setup").toLowerCase().replaceAll("_", " ");
  const embed = new EmbedBuilder().setTitle(team.teamName).setColor(0xffdc21)
    .setDescription(`${context.league.leagueName} · ${phase} · Week ${week}\n${roster.length} players`);
  if (team.payroll) {
    const payroll = team.payroll;
    embed.addFields({ name: "💵 Team salary", value: `${payroll.knownPlayers ? `${compactDollars(payroll.salary)} reported salary` : "Salary unavailable"} · ${payroll.season}\nSalary available for ${payroll.knownPlayers}/${payroll.totalPlayers} players`, inline: true });
  }
  embed.addFields({ name: "📝 Free Agency", value: faStatus.offseason ? `${faStatus.stageName}\nOpen-stage signings: **${faStatus.completedSignings}/9**\nActive offers: **${faStatus.activeTargets}/5**` : `FA Signings: **${faStatus.completedSignings}/5**\nActive FA Targets: **${faStatus.activeTargets}/${faStatus.allowedActiveTargets}**`, inline: true });
  // Compact rows keep a normal NBA roster in one embed; unusual imports are capped.
  const visible = roster.slice(0, 25);
  const lines = visible.map(entry => {
    const player = entry.player || {};
    const name = String(player.name || "Unknown").slice(0, 60);
    const position = [entry.position1 || player.position1, entry.position2 || player.position2].filter(Boolean).join("/") || "—";
    return `**${name}** · ${position} · ${player.overall ?? "—"} OVR\n${player.contractView?.compact || "Salary unavailable"}`;
  });
  if (roster.length > visible.length) lines.push(`+${roster.length - visible.length} players · /team roster for the full roster`);
  addListFields(embed, "🏀 Roster", lines.length ? lines : ["No roster imported yet."]);
  const years = new Map();
  for (const pick of team.draftPicks || []) {
    const counts = years.get(pick.draftYear) || [0, 0];
    if (pick.round === 1) counts[0]++;
    else if (pick.round === 2) counts[1]++;
    years.set(pick.draftYear, counts);
  }
  const picks = [...years].sort(([a], [b]) => a - b);
  embed.addFields({ name: "🎟️ Draft picks", value: picks.slice(0, 8).map(([year, [first, second]]) => `**${year}** · ${first} first-round · ${second} second-round`).join("\n") + (picks.length > 8 ? `\n+${picks.length - 8} more years` : "") || "No draft picks owned." });
  const upcoming = (team.schedule || []).filter(entry => entry.week >= week).slice(0, 3);
  embed.addFields({ name: "📅 Coming up", value: upcoming.map(entry => `**Week ${entry.week}** · ${entry.bye ? "Bye" : `vs ${entry.opponent}`}`).join("\n") || "Schedule not confirmed yet." });
  embed.setFooter({ text: "/player for stats, trade value & contract details · /team roster for full roster · /schedule mine" });
  return brandTeamReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("myweek:open").setLabel("MY WEEK").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(context.offseasonStep === "CUTDOWN" ? "cutdown:open" : context.league.currentPhase === "FREE_AGENCY" ? "fa:sign" : "fa:waive").setLabel(context.offseasonStep === "CUTDOWN" ? "ROSTER CUTDOWN" : context.league.currentPhase === "FREE_AGENCY" ? "FREE AGENCY" : "WAIVE PLAYER").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId("book:open").setLabel("SPORTSBOOK").setStyle(ButtonStyle.Secondary))] }, team.teamName);
}

function freeAgentsPayload(players, position = null, requestedPage = 1) {
  const available = players.filter(player => !player.teamId && !player.retiredAt && (!position || player.position1 === position))
    .sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0) || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(available.length / 15));
  const page = Math.max(1, Math.min(Number(requestedPage) || 1, pages));
  const visible = available.slice((page - 1) * 15, page * 15);
  const controls = [];
  if (pages > 1) controls.push(
    new ButtonBuilder().setCustomId(`freeagents:page:${page - 1}:${position || 'ALL'}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
    new ButtonBuilder().setCustomId(`freeagents:page:${page + 1}:${position || 'ALL'}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page === pages));
  controls.push(new ButtonBuilder().setCustomId('fa:sign').setLabel('SIGN FREE AGENT').setStyle(ButtonStyle.Primary));
  return { embeds: [new EmbedBuilder().setTitle('League Free Agents').setColor(0xffdc21)
    .setDescription(visible.map(player => `**${player.name}** · ${player.overall ?? '—'} OVR · ${positionLabel(player)} · Age ${player.age ?? '—'} · Trade Value ${Number(player.tradeValue || 1).toLocaleString('en-US')}`).join('\n\n') || 'No free agents match this position. Try /freeagents without a filter; Staff can use /roster freeagency to import missing players.')
    .setFooter({ text: `Page ${page}/${pages} · ${available.length} players · Filters use primary position. /player shows full details. Signing opens privately.` })], components: [new ActionRowBuilder().addComponents(...controls)] };
}
async function handleFreeAgentsCommand(interaction) {
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  await interaction.editReply(freeAgentsPayload(playerService.listPlayers(context.league.leagueId, context.seasonId), interaction.options.getString('position'), interaction.options.getInteger('page')));
}
async function handleFreeAgentsButton(interaction) {
  await interaction.deferUpdate();
  const context = setupService.getLeagueContextByBinding({ guildId: interaction.guildId });
  const [, , page, value] = interaction.customId.split(':');
  if (!['ALL', 'PG', 'SG', 'SF', 'PF', 'C'].includes(value)) throw Error('This position filter is no longer available. Open /freeagents again.');
  await interaction.editReply(freeAgentsPayload(playerService.listPlayers(context.league.leagueId, context.seasonId), value === 'ALL' ? null : value, page));
}

module.exports = {
  freeAgentsPayload, handleFreeAgentsButton,
  handleMyTeamCommand,
  myTeamPayload,
  handleFreeAgentsCommand,
  handlePlayerCommand,
  handlePreseasonAutocomplete,
  handleTeamsCommand,
};
