require("dotenv").config();

const { Client, EmbedBuilder, Events, GatewayIntentBits } = require("discord.js");
const { readConfig } = require("./config");
const sleeper = require("./sleeper");
const {
  getGuildConfig,
  getPlayerStatsSnapshot,
  setGuildLeague,
  setPlayerStatsSnapshot,
} = require("./store");
const {
  byRosterId,
  byUserId,
  chunkLines,
  compactPlayerLabel,
  findRosterByTeam,
  formatPoints,
  formatRecord,
  managerName,
  playerLabel,
  rosterChoiceName,
  sortStandings,
} = require("./format");

const config = readConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function requireLeagueId(interaction) {
  const guildConfig = getGuildConfig(interaction.guildId);
  const leagueId = guildConfig?.leagueId || config.sleeperLeagueId;

  if (!leagueId) {
    throw new Error("No Sleeper league connected. Run /connect league_id:<id>, or /connect username:<sleeper username> to find IDs.");
  }

  return leagueId;
}

async function currentWeek(league, optionWeek) {
  if (optionWeek) return optionWeek;
  const state = await sleeper.getSportState(league.sport || "nfl");
  return state.leg || state.display_week || state.week || league.settings?.leg || 1;
}

function requestedSeason(interaction) {
  return interaction.options.getString("season");
}

async function resolveLeagueForSeason(baseLeagueId, season) {
  let league = await sleeper.getLeague(baseLeagueId);
  if (!season || String(league.season) === String(season)) {
    return league;
  }

  const visited = new Set([league.league_id]);
  while (league.previous_league_id && !visited.has(league.previous_league_id)) {
    league = await sleeper.getLeague(league.previous_league_id);
    visited.add(league.league_id);

    if (String(league.season) === String(season)) {
      return league;
    }
  }

  throw new Error(`Could not find season ${season} from this league's history.`);
}

async function getSeasonBundle(interaction, options = {}) {
  const requested = requestedSeason(interaction);
  let league = await resolveLeagueForSeason(requireLeagueId(interaction), requested);

  if (!requested && options.preferCompleted && league.status === "pre_draft" && league.previous_league_id) {
    league = await sleeper.getLeague(league.previous_league_id);
  }

  const [users, rosters] = await Promise.all([
    sleeper.getLeagueUsers(league.league_id),
    sleeper.getRosters(league.league_id),
  ]);

  return { league, users, rosters };
}

function seasonFooter(league, requested) {
  return requested
    ? `Season ${league.season}`
    : `Defaulted to ${league.season}. Add season:<year> to choose a different season.`;
}

function applySeasonFooter(embed, league, interaction) {
  embed.setFooter({ text: seasonFooter(league, requestedSeason(interaction)) });
  return embed;
}

function commandTitle(league, label) {
  return `${league.name} - ${league.season} ${label}`;
}

function rankPrefix(index) {
  return ["1.", "2.", "3."][index] || `${index + 1}.`;
}

function statName(stat) {
  const names = {
    fantasy: "Fantasy",
    pts: "Points",
    reb: "Rebounds",
    ast: "Assists",
    stl: "Steals",
    blk: "Blocks",
    tpm: "Threes",
    to: "Turnovers",
  };

  return names[stat] || stat.toUpperCase();
}

function playerName(playerId, players) {
  const player = players[playerId];
  if (!player) return playerId;
  return player.full_name || `${player.first_name || ""} ${player.last_name || ""}`.trim() || playerId;
}

function playerBioLine(playerId, players) {
  const player = players[playerId] || {};
  const parts = [
    player.position || player.fantasy_positions?.[0],
    player.team,
    player.age ? `${player.age} yrs` : null,
    player.years_exp != null ? `${player.years_exp} exp` : null,
    player.injury_status ? `Injury: ${player.injury_status}` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" | ") : compactPlayerLabel(playerId, players);
}

function statLine(stats = {}, statsList = ["pts", "reb", "ast", "stl", "blk", "tpm", "to"]) {
  const lines = statsList
    .filter((key) => stats[key] != null)
    .map((key) => `${statName(key)}: ${shortNumber(stats[key])}`);
  return lines.join(" | ") || "No box stats.";
}

function settingPoints(settings = {}, key = "fpts") {
  const whole = settings[key] ?? 0;
  const decimal = settings[`${key}_decimal`] ?? 0;
  return Number((whole + decimal / 100).toFixed(2));
}

function shortNumber(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function teamLabel(roster, userMap) {
  return managerName(userMap.get(roster?.owner_id));
}

function trimValue(value, fallback = "No data.", maxLength = 1024) {
  const text = value || fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function teamSummaryLine(roster, userMap) {
  return `**${teamLabel(roster, userMap)}** | ${formatRecord(roster.settings)} | ${shortNumber(settingPoints(roster.settings, "fpts"))} pts`;
}

function sortedStandings(rosters) {
  return [...rosters].sort((a, b) => {
    const winDiff = (b.settings?.wins || 0) - (a.settings?.wins || 0);
    if (winDiff) return winDiff;
    return settingPoints(b.settings, "fpts") - settingPoints(a.settings, "fpts");
  });
}

async function getAllPeriodMatchups(league) {
  const lastPeriod = league.settings?.last_scored_leg || league.settings?.leg || 1;
  const periods = Array.from({ length: lastPeriod }, (_, index) => index + 1);
  const pages = await Promise.all(periods.map((period) => sleeper.getMatchups(league.league_id, period)));
  return periods.map((period, index) => ({ period, matchups: pages[index] || [] }));
}

async function getAllPeriodTransactions(league) {
  const lastPeriod = league.settings?.last_scored_leg || league.settings?.leg || 1;
  const periods = Array.from({ length: lastPeriod }, (_, index) => index + 1);
  const pages = await Promise.all(periods.map((period) => sleeper.getTransactions(league.league_id, period)));
  return periods.map((period, index) => ({ period, transactions: pages[index] || [] }));
}

function groupMatchupsById(matchups) {
  const grouped = new Map();
  for (const matchup of matchups) {
    const key = matchup.matchup_id || `solo-${matchup.roster_id}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(matchup);
  }
  return [...grouped.values()];
}

function fantasyLeadersFromMatchups(matchupPages) {
  const totals = new Map();

  for (const { matchups } of matchupPages) {
    for (const matchup of matchups) {
      for (const [playerId, points] of Object.entries(matchup.players_points || {})) {
        totals.set(playerId, (totals.get(playerId) || 0) + Number(points || 0));
      }
    }
  }

  return [...totals.entries()]
    .map(([playerId, total]) => ({ playerId, total }))
    .sort((a, b) => b.total - a.total);
}

async function statLeaders(league, stat) {
  if (stat === "fantasy") {
    return fantasyLeadersFromMatchups(await getAllPeriodMatchups(league));
  }

  const lastPeriod = league.settings?.last_scored_leg || league.settings?.leg || 1;
  const periods = Array.from({ length: lastPeriod }, (_, index) => index + 1);
  const pages = await Promise.all(periods.map((period) => sleeper.getStats(league.sport || "nfl", league.season, period)));
  const totals = new Map();

  for (const statsByPlayer of pages) {
    for (const [playerId, stats] of Object.entries(statsByPlayer || {})) {
      totals.set(playerId, (totals.get(playerId) || 0) + Number(stats?.[stat] || 0));
    }
  }

  return [...totals.entries()]
    .map(([playerId, total]) => ({ playerId, total }))
    .sort((a, b) => b.total - a.total);
}

async function optionalSleeperCall(callback, fallback) {
  try {
    return await callback();
  } catch (error) {
    console.warn(error.message);
    return fallback;
  }
}

function lastScoredPeriod(league) {
  return league.settings?.last_scored_leg || league.settings?.leg || 1;
}

async function playerSeasonSnapshot(league, playerId, selectedPeriod) {
  const lastPeriod = lastScoredPeriod(league);
  const periodCount = Math.max(lastPeriod, selectedPeriod || 1);
  const periods = Array.from({ length: periodCount }, (_, index) => index + 1);
  const sport = league.sport || "nfl";
  const [matchupPages, statsPages] = await Promise.all([
    Promise.all(periods.map((period) =>
      optionalSleeperCall(
        async () => ({ period, matchups: await sleeper.getMatchups(league.league_id, period) }),
        { period, matchups: [] },
      ),
    )),
    Promise.all(periods.map((period) =>
      optionalSleeperCall(
        async () => ({ period, stats: await sleeper.getStats(sport, league.season, period) }),
        { period, stats: {} },
      ),
    )),
  ]);
  const weekly = [];
  const totals = {};

  for (const { period, matchups } of matchupPages) {
    const matchup = matchups.find((item) => Object.prototype.hasOwnProperty.call(item.players_points || {}, playerId));
    const stats = statsPages.find((page) => page.period === period)?.stats?.[playerId] || {};
    const fantasyPoints = matchup?.players_points?.[playerId];

    for (const [key, value] of Object.entries(stats)) {
      if (typeof value === "number") {
        totals[key] = (totals[key] || 0) + value;
      }
    }

    if (fantasyPoints != null || Object.keys(stats).length) {
      weekly.push({
        period,
        fantasyPoints: fantasyPoints == null ? null : Number(fantasyPoints),
        rosterId: matchup?.roster_id || null,
        started: matchup?.starters?.includes(playerId) || false,
        stats,
      });
    }
  }

  const fantasyTotal = weekly.reduce((sum, item) => sum + Number(item.fantasyPoints || 0), 0);

  return {
    fantasyTotal,
    lastPeriod,
    totals,
    weekly,
  };
}

async function playerProjection(league, playerId, period) {
  const projections = await optionalSleeperCall(
    () => sleeper.getProjections(league.sport || "nfl", league.season, period),
    {},
  );
  return projections?.[playerId] || null;
}

function rosterBenchRegrets(roster, matchupPages, players) {
  const regrets = [];

  for (const { period, matchups } of matchupPages) {
    const matchup = matchups.find((item) => item.roster_id === roster.roster_id);
    if (!matchup?.players_points) continue;

    const starterIds = new Set((matchup.starters || []).filter(Boolean));
    const starterScores = [...starterIds].map((playerId) => Number(matchup.players_points[playerId] || 0));
    const lowestStarter = starterScores.length ? Math.min(...starterScores) : 0;

    for (const playerId of matchup.players || []) {
      if (starterIds.has(playerId)) continue;
      const points = Number(matchup.players_points[playerId] || 0);
      const swing = points - lowestStarter;
      if (swing > 0) {
        regrets.push({
          period,
          playerId,
          points,
          swing,
          label: compactPlayerLabel(playerId, players),
        });
      }
    }
  }

  return regrets.sort((a, b) => b.swing - a.swing);
}

async function handleLeague(interaction) {
  const leagueId = requireLeagueId(interaction);
  const guildConfig = getGuildConfig(interaction.guildId);
  const league = await sleeper.getLeague(leagueId);
  const source = guildConfig?.leagueId === leagueId ? "Discord server connection" : ".env fallback";
  const embed = new EmbedBuilder()
    .setTitle(league.name || "Sleeper League")
    .setColor(0x00ceb8)
    .addFields(
      { name: "League ID", value: league.league_id, inline: true },
      { name: "Season", value: String(league.season), inline: true },
      { name: "Sport", value: String(league.sport || "Unknown").toUpperCase(), inline: true },
      { name: "Teams", value: String(league.total_rosters || "Unknown"), inline: true },
      { name: "Status", value: league.status || "Unknown", inline: true },
      { name: "Source", value: source, inline: true },
    );

  await interaction.editReply({ embeds: [embed] });
}

async function handleConnect(interaction) {
  const leagueId = interaction.options.getString("league_id");
  const username = interaction.options.getString("username");
  const season = interaction.options.getString("season") || config.sleeperSeason;
  const sport = interaction.options.getString("sport");

  if (leagueId) {
    await connectLeague(interaction, leagueId);
    return;
  }

  if (!username) {
    throw new Error("Use /connect league_id:<id> to connect now, or /connect username:<sleeper username> to find league IDs.");
  }

  const user = await sleeper.getUser(username);

  if (!user?.user_id) {
    throw new Error(`No Sleeper user found for "${username}".`);
  }

  const sports = sport ? [sport] : ["nba", "nfl"];
  const leagueGroups = await Promise.all(
    sports.map(async (sportName) => {
      const leagues = await sleeper.getUserLeagues(user.user_id, season, sportName);
      return leagues.map((league) => ({ ...league, sport: league.sport || sportName }));
    }),
  );
  const leagues = leagueGroups.flat();
  const lines = leagues.map((league) => {
    const teams = league.total_rosters ? `, ${league.total_rosters} teams` : "";
    const sportLabel = league.sport ? `${league.sport.toUpperCase()}, ` : "";
    return `**${league.name}**\n${sportLabel}${league.season}${teams}\n\`/connect league_id:${league.league_id}\``;
  });

  if (!lines.length) {
    await interaction.editReply(`No NBA or NFL leagues found for ${username} in ${season}.`);
    return;
  }

  const chunks = chunkLines(lines, 1800);
  await interaction.editReply(`Leagues for ${user.display_name || username} in ${season}:\n\n${chunks[0]}`);

  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({ content: chunk, ephemeral: false });
  }
}

async function connectLeague(interaction, leagueId) {
  const league = await sleeper.getLeague(leagueId);

  if (!league?.league_id) {
    throw new Error(`No Sleeper league found for ID "${leagueId}".`);
  }

  const saved = setGuildLeague(interaction.guildId, league);
  const embed = new EmbedBuilder()
    .setTitle("Sleeper League Connected")
    .setColor(0x00ceb8)
    .addFields(
      { name: "League", value: saved.leagueName, inline: true },
      { name: "League ID", value: saved.leagueId, inline: true },
      { name: "Season", value: saved.season || "Unknown", inline: true },
      { name: "Sport", value: saved.sport ? saved.sport.toUpperCase() : "Unknown", inline: true },
    );

  await interaction.editReply({ embeds: [embed] });
}

async function handleStandings(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const userMap = byUserId(users);
  const lines = sortedStandings(rosters).map((roster, index) => {
    const fpts = settingPoints(roster.settings, "fpts");
    const ppts = settingPoints(roster.settings, "ppts");
    return `${rankPrefix(index)} **${teamLabel(roster, userMap)}** | ${formatRecord(roster.settings)} | ${shortNumber(fpts)} pts | ${shortNumber(ppts)} pot`;
  });

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Standings"))
    .setColor(0x00ceb8)
    .setDescription(lines.join("\n") || "No rosters found.");
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleMatchups(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const week = await currentWeek(league, interaction.options.getInteger("week"));
  const matchups = await sleeper.getMatchups(league.league_id, week);
  const rosterMap = byRosterId(rosters);
  const userMap = byUserId(users);
  const grouped = new Map();

  for (const matchup of matchups) {
    if (!grouped.has(matchup.matchup_id)) grouped.set(matchup.matchup_id, []);
    grouped.get(matchup.matchup_id).push(matchup);
  }

  const lines = [...grouped.values()].map((teams) => {
    const sorted = teams.sort((a, b) => (b.points || 0) - (a.points || 0));
    const [winner, loser] = sorted;
    if (!loser) {
      return `**${teamLabel(rosterMap.get(winner.roster_id), userMap)}** | ${shortNumber(winner.points)}`;
    }

    const margin = Number(winner.points || 0) - Number(loser.points || 0);
    return `**${teamLabel(rosterMap.get(winner.roster_id), userMap)}** ${shortNumber(winner.points)} over ${teamLabel(rosterMap.get(loser.roster_id), userMap)} ${shortNumber(loser.points)} | +${shortNumber(margin)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, `Matchups - Period ${week}`))
    .setColor(0x00ceb8)
    .setDescription(lines.join("\n") || `No matchups found for period ${week}. League status: ${league.status || "unknown"}.`);
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleRoster(interaction) {
  const query = interaction.options.getString("team", true);
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const roster = findRosterByTeam(query, users, rosters);

  if (!roster) {
    await interaction.editReply(`No roster matched "${query}". Pick one of the autocomplete suggestions for /roster.`);
    return;
  }

  const players = await sleeper.getPlayers(league.sport || "nfl");
  const userMap = byUserId(users);
  const user = userMap.get(roster.owner_id);
  const starterIds = (roster.starters || []).filter((playerId) => playerId && playerId !== "0");
  const starters = new Set(starterIds);
  const reserve = new Set(roster.reserve || []);
  const taxi = new Set(roster.taxi || []);
  const rosterPlayers = (roster.players || []).filter((playerId) => playerId && playerId !== "0");
  const starterSlots = (league.roster_positions || [])
    .filter((slot) => !["BN", "BE", "IR", "TAXI"].includes(slot))
    .slice(0, roster.starters?.length || 0);
  const starterLines = (roster.starters || [])
    .map((playerId, index) => {
      const slot = starterSlots[index] || "S";
      return playerId && playerId !== "0"
        ? `\`${slot}\` ${compactPlayerLabel(playerId, players)}`
        : `\`${slot}\` Empty`;
    });
  const benchLines = rosterPlayers
    .filter((playerId) => !starters.has(playerId) && !reserve.has(playerId) && !taxi.has(playerId))
    .map((playerId) => compactPlayerLabel(playerId, players));
  const taxiLines = [...taxi].map((playerId) => compactPlayerLabel(playerId, players));
  const reserveLines = [...reserve].map((playerId) => compactPlayerLabel(playerId, players));
  const summary = [
    `Record: ${formatRecord(roster.settings)} | Points: ${formatPoints(roster.settings)} | Waiver: #${roster.settings?.waiver_position ?? "N/A"}`,
    `${rosterPlayers.length} players: ${starterIds.length} starters, ${benchLines.length} bench, ${taxiLines.length} taxi, ${reserveLines.length} reserve`,
  ].join("\n");
  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, managerName(user)))
    .setColor(0x00ceb8)
    .setDescription(summary)
    .addFields(
      { name: "Starters", value: starterLines.join("\n") || "No starters set.", inline: false },
      { name: "Bench", value: benchLines.join("\n") || "No bench players.", inline: false },
    )
    .setFooter({ text: `${user?.display_name || "Unknown Manager"} - Roster ${roster.roster_id}` });

  if (taxiLines.length) {
    embed.addFields({ name: "Taxi", value: taxiLines.join("\n"), inline: false });
  }

  if (reserveLines.length) {
    embed.addFields({ name: "Reserve", value: reserveLines.join("\n"), inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}

function transactionTypeLabel(type) {
  const labels = {
    commissioner: "Commissioner Move",
    free_agent: "Free Agent",
    trade: "Trade",
    waiver: "Waiver",
  };

  return labels[type] || type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function teamNameForRoster(rosterId, rosterMap, userMap) {
  const roster = rosterMap.get(Number(rosterId)) || rosterMap.get(rosterId);
  return managerName(userMap.get(roster?.owner_id));
}

function transactionField(transaction, rosterMap, userMap, players) {
  const rosterIds = new Set([
    ...Object.values(transaction.adds || {}),
    ...Object.values(transaction.drops || {}),
    ...(transaction.roster_ids || []),
  ]);
  const lines = [];

  for (const rosterId of rosterIds) {
    const added = Object.entries(transaction.adds || {})
      .filter(([, addRosterId]) => String(addRosterId) === String(rosterId))
      .map(([playerId]) => playerLabel(playerId, players));
    const dropped = Object.entries(transaction.drops || {})
      .filter(([, dropRosterId]) => String(dropRosterId) === String(rosterId))
      .map(([playerId]) => playerLabel(playerId, players));

    if (!added.length && !dropped.length) continue;

    lines.push(`**${teamNameForRoster(rosterId, rosterMap, userMap)}**`);
    if (added.length) lines.push(`Added: ${added.join(", ")}`);
    if (dropped.length) lines.push(`Dropped: ${dropped.join(", ")}`);
  }

  const created = transaction.created ? ` - <t:${Math.floor(transaction.created / 1000)}:R>` : "";
  const status = transaction.status && transaction.status !== "complete" ? ` (${transaction.status})` : "";

  return {
    name: `${transactionTypeLabel(transaction.type)}${status}${created}`,
    value: trimValue(lines.join("\n") || "No player movement listed.", "No player movement listed.", 900),
  };
}

async function handleTransactions(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const week = await currentWeek(league, interaction.options.getInteger("week"));
  const type = interaction.options.getString("type");
  const [transactions, players] = await Promise.all([
    sleeper.getTransactions(league.league_id, week),
    sleeper.getPlayers(league.sport || "nfl"),
  ]);
  const rosterMap = byRosterId(rosters);
  const userMap = byUserId(users);
  const filtered = type ? transactions.filter((transaction) => transaction.type === type) : transactions;
  const fields = filtered
    .slice(0, 10)
    .map((transaction) => transactionField(transaction, rosterMap, userMap, players));

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, `Transactions - Period ${week}`))
    .setColor(0x00ceb8);
  applySeasonFooter(embed, league, interaction);

  if (fields.length) {
    embed.addFields(fields);
  } else {
    embed.setDescription("No transactions found.");
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleHistory(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const userMap = byUserId(users);
  const [matchupPages, transactionPages, winnersBracket, tradedPicks, leagueDrafts] = await Promise.all([
    getAllPeriodMatchups(league),
    getAllPeriodTransactions(league),
    sleeper.getWinnersBracket(league.league_id),
    sleeper.getTradedPicks(league.league_id),
    sleeper.getLeagueDrafts(league.league_id),
  ]);
  const standings = sortedStandings(rosters);
  const championRoster = rosters.find((roster) => String(roster.roster_id) === String(league.metadata?.latest_league_winner_roster_id));
  const matchupCount = matchupPages.reduce((sum, page) => sum + groupMatchupsById(page.matchups).length, 0);
  const transactionCount = transactionPages.reduce((sum, page) => sum + page.transactions.length, 0);
  const highWeek = matchupPages
    .flatMap((page) => page.matchups.map((matchup) => ({ period: page.period, matchup })))
    .sort((a, b) => Number(b.matchup.points || 0) - Number(a.matchup.points || 0))[0];

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Season Hub"))
    .setColor(0x00ceb8)
    .setDescription(championRoster ? `Champion: **${teamLabel(championRoster, userMap)}**` : "Season overview")
    .addFields(
      {
        name: "Snapshot",
        value: [
          `Status: ${league.status}`,
          `Sport: ${(league.sport || "unknown").toUpperCase()}`,
          `Teams: ${league.total_rosters}`,
          `Periods: ${league.settings?.last_scored_leg || league.settings?.leg || "N/A"}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Activity",
        value: [
          `Matchups: ${matchupCount}`,
          `Transactions: ${transactionCount}`,
          `Trades/Picks: ${tradedPicks.length}`,
          `Drafts: ${leagueDrafts.length}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Top 5",
        value: trimValue(standings.slice(0, 5).map((roster, index) => `${rankPrefix(index)} ${teamSummaryLine(roster, userMap)}`).join("\n")),
        inline: false,
      },
      {
        name: "Best Week",
        value: highWeek
          ? `Period ${highWeek.period}: **${teamLabel(byRosterId(rosters).get(highWeek.matchup.roster_id), userMap)}** scored ${shortNumber(highWeek.matchup.points)}`
          : "No matchup data.",
        inline: false,
      },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleLeaders(interaction) {
  const stat = interaction.options.getString("stat", true);
  const { league } = await getSeasonBundle(interaction, { preferCompleted: true });
  const players = await sleeper.getPlayers(league.sport || "nfl");
  const leaders = await statLeaders(league, stat);
  const statLabel = statName(stat);
  const lines = leaders.slice(0, 12).map((leader, index) => {
    const label = compactPlayerLabel(leader.playerId, players);
    return `${rankPrefix(index)} **${label}** | ${shortNumber(leader.total)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, `${statLabel} Leaders`))
    .setColor(0x00ceb8)
    .setDescription(trimValue(lines.join("\n")));

  if (stat !== "fantasy") {
    embed.setFooter({ text: `${seasonFooter(league, requestedSeason(interaction))} Stats use Sleeper's stats endpoint.` });
  } else {
    applySeasonFooter(embed, league, interaction);
  }

  await interaction.editReply({ embeds: [embed] });
}

function bracketLines(bracket, rosterMap, userMap) {
  return bracket.map((game) => {
    const t1 = teamLabel(rosterMap.get(game.t1), userMap);
    const t2 = teamLabel(rosterMap.get(game.t2), userMap);
    const winner = game.w ? teamLabel(rosterMap.get(game.w), userMap) : "TBD";
    const placeLabels = {
      1: "Final",
      3: "3rd Place",
      5: "5th Place",
      7: "7th Place",
    };
    const label = game.p ? placeLabels[game.p] || `${game.p}th Place` : `Round ${game.r}`;
    return `**${label}** | ${winner} over ${winner === t1 ? t2 : t1}`;
  });
}

async function handlePlayoffs(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const [winners, losers] = await Promise.all([
    sleeper.getWinnersBracket(league.league_id),
    sleeper.getLosersBracket(league.league_id),
  ]);
  const rosterMap = byRosterId(rosters);
  const userMap = byUserId(users);

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Playoffs"))
    .setColor(0x00ceb8)
    .addFields(
      { name: "Winners Bracket", value: trimValue(bracketLines(winners, rosterMap, userMap).join("\n")), inline: false },
      { name: "Consolation", value: trimValue(bracketLines(losers, rosterMap, userMap).join("\n")), inline: false },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleTeam(interaction) {
  const query = interaction.options.getString("team", true);
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const roster = findRosterByTeam(query, users, rosters);
  if (!roster) {
    await interaction.editReply("No team matched that choice.");
    return;
  }

  const [matchupPages, transactionPages, players] = await Promise.all([
    getAllPeriodMatchups(league),
    getAllPeriodTransactions(league),
    sleeper.getPlayers(league.sport || "nfl"),
  ]);
  const userMap = byUserId(users);
  const txCount = transactionPages.reduce((sum, page) =>
    sum + page.transactions.filter((tx) => (tx.roster_ids || []).includes(roster.roster_id)).length, 0);
  const weeklyScores = matchupPages
    .map(({ period, matchups }) => ({ period, matchup: matchups.find((item) => item.roster_id === roster.roster_id) }))
    .filter((item) => item.matchup);
  const bestWeek = [...weeklyScores].sort((a, b) => Number(b.matchup.points || 0) - Number(a.matchup.points || 0))[0];
  const regrets = rosterBenchRegrets(roster, matchupPages, players);
  const potentialGap = settingPoints(roster.settings, "ppts") - settingPoints(roster.settings, "fpts");

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, teamLabel(roster, userMap)))
    .setColor(0x00ceb8)
    .addFields(
      {
        name: "Season Line",
        value: [
          `Record: ${formatRecord(roster.settings)}`,
          `Points: ${shortNumber(settingPoints(roster.settings, "fpts"))}`,
          `Potential: ${shortNumber(settingPoints(roster.settings, "ppts"))}`,
          `Points Against: ${shortNumber(settingPoints(roster.settings, "fpts_against"))}`,
          `Streak: ${roster.metadata?.streak || "N/A"}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Team Notes",
        value: [
          `Waiver: #${roster.settings?.waiver_position ?? "N/A"}`,
          `Moves: ${roster.settings?.total_moves ?? 0}`,
          `Transactions: ${txCount}`,
          `Potential Gap: ${shortNumber(potentialGap)}`,
          `Roster: ${(roster.players || []).length} players`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Best Week",
        value: bestWeek ? `Period ${bestWeek.period}: ${shortNumber(bestWeek.matchup.points)} points` : "No matchup data.",
        inline: true,
      },
      {
        name: "Bench Regrets",
        value: trimValue(regrets.slice(0, 5).map((regret) =>
          `P${regret.period}: **${regret.label}** | ${shortNumber(regret.points)} pts | +${shortNumber(regret.swing)}`,
        ).join("\n")),
        inline: false,
      },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleRecap(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const period = await currentWeek(league, interaction.options.getInteger("week"));
  const [matchups, players] = await Promise.all([
    sleeper.getMatchups(league.league_id, period),
    sleeper.getPlayers(league.sport || "nfl"),
  ]);
  const rosterMap = byRosterId(rosters);
  const userMap = byUserId(users);
  const teamScores = matchups.map((matchup) => ({ matchup, roster: rosterMap.get(matchup.roster_id) }));
  const highScore = [...teamScores].sort((a, b) => Number(b.matchup.points || 0) - Number(a.matchup.points || 0))[0];
  const grouped = groupMatchupsById(matchups).filter((group) => group.length > 1);
  const closeGame = [...grouped].sort((a, b) =>
    Math.abs(Number(a[0].points || 0) - Number(a[1].points || 0)) -
    Math.abs(Number(b[0].points || 0) - Number(b[1].points || 0)),
  )[0];
  const blowout = [...grouped].sort((a, b) =>
    Math.abs(Number(b[0].points || 0) - Number(b[1].points || 0)) -
    Math.abs(Number(a[0].points || 0) - Number(a[1].points || 0)),
  )[0];
  const playerScores = fantasyLeadersFromMatchups([{ period, matchups }]).slice(0, 5);

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, `Period ${period} Recap`))
    .setColor(0x00ceb8)
    .addFields(
      {
        name: "High Score",
        value: highScore ? `**${teamLabel(highScore.roster, userMap)}**\n${shortNumber(highScore.matchup.points)} pts` : "No data.",
        inline: true,
      },
      {
        name: "Closest Game",
        value: closeGame
          ? `**${teamLabel(rosterMap.get(closeGame[0].roster_id), userMap)}** ${shortNumber(closeGame[0].points)} vs **${teamLabel(rosterMap.get(closeGame[1].roster_id), userMap)}** ${shortNumber(closeGame[1].points)}`
          : "No data.",
        inline: false,
      },
      {
        name: "Biggest Blowout",
        value: blowout
          ? `**${teamLabel(rosterMap.get(blowout[0].roster_id), userMap)}** ${shortNumber(blowout[0].points)} vs **${teamLabel(rosterMap.get(blowout[1].roster_id), userMap)}** ${shortNumber(blowout[1].points)}`
          : "No data.",
        inline: false,
      },
      {
        name: "Top Players",
        value: trimValue(playerScores.map((score, index) => `${rankPrefix(index)} **${compactPlayerLabel(score.playerId, players)}** | ${shortNumber(score.total)}`).join("\n")),
        inline: false,
      },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleDraft(interaction) {
  const { league, users } = await getSeasonBundle(interaction, { preferCompleted: true });
  const draftId = league.draft_id;
  if (!draftId) {
    await interaction.editReply("No draft found for this season.");
    return;
  }

  const [draft, picks, tradedPicks] = await Promise.all([
    sleeper.getDraft(draftId),
    sleeper.getDraftPicks(draftId),
    sleeper.getDraftTradedPicks(draftId),
  ]);
  const userMap = byUserId(users);
  const lines = picks.slice(0, 24).map((pick) => {
    const player = [pick.metadata?.first_name, pick.metadata?.last_name].filter(Boolean).join(" ") || pick.player_id || "Unknown";
    const team = pick.metadata?.team ? ` - ${pick.metadata.team}` : "";
    const position = pick.metadata?.position ? ` ${pick.metadata.position}` : "";
    const picker = managerName(userMap.get(pick.picked_by));
    return `${pick.pick_no}. **${player}${position}${team}** | ${picker}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Draft"))
    .setColor(0x00ceb8)
    .setDescription(trimValue(lines.join("\n")))
    .addFields(
      { name: "Format", value: `${draft.type || "Unknown"} - ${draft.settings?.rounds || "?"} rounds`, inline: true },
      { name: "Picks", value: String(picks.length), inline: true },
      { name: "Traded Picks", value: String(tradedPicks.length), inline: true },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handlePlayer(interaction) {
  const playerId = interaction.options.getString("player", true);
  const selectedPeriod = interaction.options.getInteger("week");
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const players = await sleeper.getPlayers(league.sport || "nfl");
  const player = players[playerId];

  if (!player) {
    await interaction.editReply(`No player matched "${playerId}". Pick one of the autocomplete suggestions for /player.`);
    return;
  }

  const projectionPeriod = selectedPeriod || lastScoredPeriod(league);
  const [snapshot, projection] = await Promise.all([
    playerSeasonSnapshot(league, playerId, selectedPeriod),
    playerProjection(league, playerId, projectionPeriod),
  ]);
  const previousCache = getPlayerStatsSnapshot(league.league_id, league.season, playerId);
  const cached = setPlayerStatsSnapshot(league.league_id, league.season, playerId, {
    player: {
      name: playerName(playerId, players),
      position: player.position || player.fantasy_positions?.[0] || null,
      team: player.team || null,
    },
    fantasyTotal: snapshot.fantasyTotal,
    totals: snapshot.totals,
    weekly: snapshot.weekly,
  });
  const userMap = byUserId(users);
  const roster = rosters.find((item) => (item.players || []).includes(playerId));
  const manager = roster ? teamLabel(roster, userMap) : "Free Agent";
  const shownWeeks = selectedPeriod
    ? snapshot.weekly.filter((item) => item.period === selectedPeriod)
    : snapshot.weekly.slice(-8);
  const gameLog = shownWeeks.map((item) => {
    const role = item.started ? "Start" : "Bench";
    return `P${item.period} | ${role} | ${shortNumber(item.fantasyPoints)} fantasy | ${statLine(item.stats, ["pts", "reb", "ast"])}`;
  });
  const totalStats = statLine(snapshot.totals);
  const projectionLine = projection
    ? [
      projection.pts != null ? `PTS ${shortNumber(projection.pts)}` : null,
      projection.reb != null ? `REB ${shortNumber(projection.reb)}` : null,
      projection.ast != null ? `AST ${shortNumber(projection.ast)}` : null,
      projection.fpts != null ? `FANT ${shortNumber(projection.fpts)}` : null,
    ].filter(Boolean).join(" | ")
    : "No projection available.";
  const cacheText = previousCache?.updatedAt
    ? `Updated local stat cache. Previous cache: ${new Date(previousCache.updatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}`
    : "Saved this player to the local stat cache.";

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, playerName(playerId, players)))
    .setColor(0x00ceb8)
    .setDescription(`${playerBioLine(playerId, players)}\nRostered by: **${manager}**`)
    .addFields(
      {
        name: "Season",
        value: [
          `Fantasy: ${shortNumber(snapshot.fantasyTotal)}`,
          `Games with data: ${snapshot.weekly.length}`,
          totalStats,
        ].join("\n"),
        inline: false,
      },
      {
        name: selectedPeriod ? `Period ${selectedPeriod}` : "Recent Game Log",
        value: trimValue(gameLog.join("\n"), "No weekly stat data found for this player.", 1000),
        inline: false,
      },
      {
        name: `Projection - Period ${projectionPeriod}`,
        value: projectionLine,
        inline: false,
      },
    )
    .setFooter({ text: `${seasonFooter(league, requestedSeason(interaction))} ${cacheText} Cache entries: ${cached.weekly.length} weeks.` });

  await interaction.editReply({ embeds: [embed] });
}

async function handleCompare(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const teamA = findRosterByTeam(interaction.options.getString("team_a", true), users, rosters);
  const teamB = findRosterByTeam(interaction.options.getString("team_b", true), users, rosters);

  if (!teamA || !teamB) {
    await interaction.editReply("Could not find both teams. Pick from autocomplete suggestions.");
    return;
  }

  const userMap = byUserId(users);
  const line = (roster) => [
    `Record: ${formatRecord(roster.settings)}`,
    `Points: ${shortNumber(settingPoints(roster.settings, "fpts"))}`,
    `Potential: ${shortNumber(settingPoints(roster.settings, "ppts"))}`,
    `Against: ${shortNumber(settingPoints(roster.settings, "fpts_against"))}`,
    `Streak: ${roster.metadata?.streak || "N/A"}`,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Compare"))
    .setColor(0x00ceb8)
    .addFields(
      { name: teamLabel(teamA, userMap), value: line(teamA), inline: true },
      { name: teamLabel(teamB, userMap), value: line(teamB), inline: true },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handlePlayerAutocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused().toLowerCase();
    const { league, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
    const players = await sleeper.getPlayers(league.sport || "nfl");
    const rosteredIds = [...new Set(rosters.flatMap((roster) => roster.players || []))]
      .filter((playerId) => playerId && playerId !== "0");
    const choices = rosteredIds
      .map((playerId) => {
        const player = players[playerId] || {};
        const name = playerName(playerId, players);
        const label = compactPlayerLabel(playerId, players);
        const search = [
          name,
          player.first_name,
          player.last_name,
          player.position,
          player.team,
          playerId,
        ].filter(Boolean).join(" ").toLowerCase();

        return {
          name: label.slice(0, 100),
          value: String(playerId),
          search,
        };
      })
      .filter((choice) => !focused || choice.search.includes(focused))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 25)
      .map(({ name, value }) => ({ name, value }));

    await interaction.respond(choices);
  } catch (error) {
    console.error(error);
    await interaction.respond([]);
  }
}

async function handleRosterAutocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused().toLowerCase();
    const { users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
    const userMap = byUserId(users);
    const choices = rosters
      .map((roster) => {
        const user = userMap.get(roster.owner_id);
        const name = rosterChoiceName(user, roster).trim();
        const search = [
          name,
          user?.display_name,
          user?.username,
          String(roster.roster_id),
        ].filter(Boolean).join(" ").toLowerCase();

        return {
          name: name.slice(0, 100),
          value: String(roster.roster_id),
          search,
        };
      })
      .filter((choice) => !focused || choice.search.includes(focused))
      .slice(0, 25)
      .map(({ name, value }) => ({ name, value }));

    await interaction.respond(choices);
  } catch (error) {
    console.error(error);
    await interaction.respond([]);
  }
}

const handlers = {
  compare: handleCompare,
  connect: handleConnect,
  draft: handleDraft,
  history: handleHistory,
  league: handleLeague,
  leaders: handleLeaders,
  matchups: handleMatchups,
  player: handlePlayer,
  playoffs: handlePlayoffs,
  recap: handleRecap,
  roster: handleRoster,
  standings: handleStandings,
  team: handleTeam,
  transactions: handleTransactions,
};

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === "player") {
      await handlePlayerAutocomplete(interaction);
    } else if (["roster", "team", "compare"].includes(interaction.commandName)) {
      await handleRosterAutocomplete(interaction);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const handler = handlers[interaction.commandName];
  if (!handler) return;

  try {
    await interaction.deferReply();
    await handler(interaction);
  } catch (error) {
    console.error(error);
    const message = `Error: ${error.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

client.login(config.discordToken);
