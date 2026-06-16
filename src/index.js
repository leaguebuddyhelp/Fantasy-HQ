require("dotenv").config();

const { Client, EmbedBuilder, Events, GatewayIntentBits } = require("discord.js");
const { readConfig } = require("./config");
const sleeper = require("./sleeper");
const { getGuildConfig, setGuildLeague } = require("./store");
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
  return `**${teamLabel(roster, userMap)}** - ${formatRecord(roster.settings)} - ${shortNumber(settingPoints(roster.settings, "fpts"))} pts`;
}

function sortedStandings(rosters) {
  return [...rosters].sort((a, b) => {
    const winDiff = (b.settings?.wins || 0) - (a.settings?.wins || 0);
    if (winDiff) return winDiff;
    return settingPoints(b.settings, "fpts") - settingPoints(a.settings, "fpts");
  });
}

function powerScore(roster, maxWins, maxFpts, maxPpts) {
  const wins = roster.settings?.wins || 0;
  const fpts = settingPoints(roster.settings, "fpts");
  const ppts = settingPoints(roster.settings, "ppts");
  return (
    (maxWins ? wins / maxWins : 0) * 45 +
    (maxFpts ? fpts / maxFpts : 0) * 35 +
    (maxPpts ? ppts / maxPpts : 0) * 20
  );
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
    return `**${league.name}** (${sportLabel}${league.season}${teams})\nConnect: \`/connect league_id:${league.league_id}\``;
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
  const lines = sortedStandings(rosters).map((roster, index) => `${index + 1}. ${teamSummaryLine(roster, userMap)}`);

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} Standings - ${league.season}`)
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
    return sorted
      .map((team) => {
        const roster = rosterMap.get(team.roster_id);
        const user = userMap.get(roster?.owner_id);
        return `**${managerName(user)}**: ${(team.points || 0).toFixed(2)}`;
      })
      .join(" vs ");
  });

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} Matchups - ${league.season} Period ${week}`)
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
    `Record: ${formatRecord(roster.settings)}`,
    `Points: ${formatPoints(roster.settings)}`,
    `Waiver: #${roster.settings?.waiver_position ?? "N/A"}`,
    `Moves: ${roster.settings?.total_moves ?? 0}`,
    `Players: ${rosterPlayers.length} total, ${starterIds.length} starters, ${benchLines.length} bench, ${taxiLines.length} taxi, ${reserveLines.length} reserve`,
  ].join("\n");
  const embed = new EmbedBuilder()
    .setTitle(managerName(user))
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
    value: lines.join("\n") || "No player movement listed.",
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
    .setTitle(`${league.name} Transactions - ${league.season} Period ${week}`)
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
    .setTitle(`${league.name} ${league.season} History`)
    .setColor(0x00ceb8)
    .addFields(
      {
        name: "Season",
        value: [
          `Status: ${league.status}`,
          `Sport: ${(league.sport || "unknown").toUpperCase()}`,
          `Teams: ${league.total_rosters}`,
          `Periods: ${league.settings?.last_scored_leg || league.settings?.leg || "N/A"}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Champion",
        value: championRoster ? teamLabel(championRoster, userMap) : "Not available",
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
        name: "Top Teams",
        value: trimValue(standings.slice(0, 5).map((roster, index) => `${index + 1}. ${teamSummaryLine(roster, userMap)}`).join("\n")),
        inline: false,
      },
      {
        name: "Best Weekly Score",
        value: highWeek
          ? `${teamLabel(byRosterId(rosters).get(highWeek.matchup.roster_id), userMap)} scored ${shortNumber(highWeek.matchup.points)} in period ${highWeek.period}`
          : "No matchup data.",
        inline: false,
      },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleAwards(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const userMap = byUserId(users);
  const standings = sortedStandings(rosters);
  const championRoster = rosters.find((roster) => String(roster.roster_id) === String(league.metadata?.latest_league_winner_roster_id));
  const bestRecord = standings[0];
  const topScorer = [...rosters].sort((a, b) => settingPoints(b.settings, "fpts") - settingPoints(a.settings, "fpts"))[0];
  const mostAgainst = [...rosters].sort((a, b) => settingPoints(b.settings, "fpts_against") - settingPoints(a.settings, "fpts_against"))[0];
  const bestPotential = [...rosters].sort((a, b) => settingPoints(b.settings, "ppts") - settingPoints(a.settings, "ppts"))[0];
  const biggestGap = [...rosters].sort((a, b) =>
    (settingPoints(b.settings, "ppts") - settingPoints(b.settings, "fpts")) -
    (settingPoints(a.settings, "ppts") - settingPoints(a.settings, "fpts")),
  )[0];
  const hottest = [...rosters]
    .filter((roster) => roster.metadata?.streak)
    .sort((a, b) => {
      const aNum = Number.parseInt(a.metadata.streak, 10) || 0;
      const bNum = Number.parseInt(b.metadata.streak, 10) || 0;
      return bNum - aNum;
    })[0];

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} ${league.season} Awards`)
    .setColor(0x00ceb8)
    .addFields(
      { name: "Champion", value: championRoster ? teamLabel(championRoster, userMap) : "Not available", inline: true },
      { name: "Best Record", value: `${teamLabel(bestRecord, userMap)} (${formatRecord(bestRecord.settings)})`, inline: true },
      { name: "Top Scorer", value: `${teamLabel(topScorer, userMap)} (${shortNumber(settingPoints(topScorer.settings, "fpts"))})`, inline: true },
      { name: "Most Points Against", value: `${teamLabel(mostAgainst, userMap)} (${shortNumber(settingPoints(mostAgainst.settings, "fpts_against"))})`, inline: true },
      { name: "Best Potential", value: `${teamLabel(bestPotential, userMap)} (${shortNumber(settingPoints(bestPotential.settings, "ppts"))})`, inline: true },
      { name: "Lineup Pain", value: `${teamLabel(biggestGap, userMap)} (${shortNumber(settingPoints(biggestGap.settings, "ppts") - settingPoints(biggestGap.settings, "fpts"))} potential pts left)`, inline: true },
      { name: "Hottest Finish", value: hottest ? `${teamLabel(hottest, userMap)} (${hottest.metadata.streak})` : "Not available", inline: true },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleLeaders(interaction) {
  const stat = interaction.options.getString("stat", true);
  const { league } = await getSeasonBundle(interaction, { preferCompleted: true });
  const players = await sleeper.getPlayers(league.sport || "nfl");
  const leaders = await statLeaders(league, stat);
  const statLabel = stat === "fantasy" ? "Fantasy Points" : stat.toUpperCase();
  const lines = leaders.slice(0, 12).map((leader, index) => {
    const label = compactPlayerLabel(leader.playerId, players);
    return `${index + 1}. **${label}** - ${shortNumber(leader.total)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} ${league.season} Leaders - ${statLabel}`)
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
    return `**${label}:** ${winner} beat ${winner === t1 ? t2 : t1}`;
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
    .setTitle(`${league.name} ${league.season} Playoffs`)
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
    .setTitle(`${teamLabel(roster, userMap)} - ${league.season}`)
    .setColor(0x00ceb8)
    .addFields(
      {
        name: "Profile",
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
        name: "Manager Notes",
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
          `P${regret.period}: ${regret.label} scored ${shortNumber(regret.points)} (+${shortNumber(regret.swing)})`,
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
    .setTitle(`${league.name} ${league.season} Period ${period} Recap`)
    .setColor(0x00ceb8)
    .addFields(
      {
        name: "High Score",
        value: highScore ? `${teamLabel(highScore.roster, userMap)} - ${shortNumber(highScore.matchup.points)}` : "No data.",
        inline: true,
      },
      {
        name: "Closest Game",
        value: closeGame
          ? `${teamLabel(rosterMap.get(closeGame[0].roster_id), userMap)} ${shortNumber(closeGame[0].points)} vs ${teamLabel(rosterMap.get(closeGame[1].roster_id), userMap)} ${shortNumber(closeGame[1].points)}`
          : "No data.",
        inline: false,
      },
      {
        name: "Biggest Blowout",
        value: blowout
          ? `${teamLabel(rosterMap.get(blowout[0].roster_id), userMap)} ${shortNumber(blowout[0].points)} vs ${teamLabel(rosterMap.get(blowout[1].roster_id), userMap)} ${shortNumber(blowout[1].points)}`
          : "No data.",
        inline: false,
      },
      {
        name: "Top Players",
        value: trimValue(playerScores.map((score, index) => `${index + 1}. ${compactPlayerLabel(score.playerId, players)} - ${shortNumber(score.total)}`).join("\n")),
        inline: false,
      },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handlePower(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const userMap = byUserId(users);
  const maxWins = Math.max(...rosters.map((roster) => roster.settings?.wins || 0));
  const maxFpts = Math.max(...rosters.map((roster) => settingPoints(roster.settings, "fpts")));
  const maxPpts = Math.max(...rosters.map((roster) => settingPoints(roster.settings, "ppts")));
  const lines = [...rosters]
    .map((roster) => ({ roster, score: powerScore(roster, maxWins, maxFpts, maxPpts) }))
    .sort((a, b) => b.score - a.score)
    .map((item, index) => `${index + 1}. **${teamLabel(item.roster, userMap)}** - ${shortNumber(item.score)} (${formatRecord(item.roster.settings)})`);

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} ${league.season} Power Rankings`)
    .setColor(0x00ceb8)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${seasonFooter(league, requestedSeason(interaction))} Formula: wins 45%, points 35%, potential points 20%.` });

  await interaction.editReply({ embeds: [embed] });
}

async function handleWeeklyHighs(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const [matchupPages, players] = await Promise.all([
    getAllPeriodMatchups(league),
    sleeper.getPlayers(league.sport || "nfl"),
  ]);
  const rosterMap = byRosterId(rosters);
  const userMap = byUserId(users);
  const teamHighs = matchupPages.map(({ period, matchups }) => {
    const high = [...matchups].sort((a, b) => Number(b.points || 0) - Number(a.points || 0))[0];
    return high ? `P${period}: **${teamLabel(rosterMap.get(high.roster_id), userMap)}** - ${shortNumber(high.points)}` : null;
  }).filter(Boolean);
  const playerHighs = matchupPages.map(({ period, matchups }) => {
    const high = fantasyLeadersFromMatchups([{ period, matchups }])[0];
    return high ? `P${period}: **${compactPlayerLabel(high.playerId, players)}** - ${shortNumber(high.total)}` : null;
  }).filter(Boolean);

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} ${league.season} Weekly Highs`)
    .setColor(0x00ceb8)
    .addFields(
      { name: "Team High Scores", value: trimValue(teamHighs.join("\n")), inline: false },
      { name: "Player High Scores", value: trimValue(playerHighs.join("\n")), inline: false },
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
    return `${pick.pick_no}. **${player}${position}${team}** to ${picker}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} ${league.season} Draft`)
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

async function handleReceipts(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const [matchupPages, players] = await Promise.all([
    getAllPeriodMatchups(league),
    sleeper.getPlayers(league.sport || "nfl"),
  ]);
  const rosterMap = byRosterId(rosters);
  const userMap = byUserId(users);
  const games = matchupPages.flatMap(({ period, matchups }) =>
    groupMatchupsById(matchups)
      .filter((group) => group.length > 1)
      .map((group) => ({ period, teams: group })),
  );
  const closest = [...games].sort((a, b) =>
    Math.abs(Number(a.teams[0].points || 0) - Number(a.teams[1].points || 0)) -
    Math.abs(Number(b.teams[0].points || 0) - Number(b.teams[1].points || 0)),
  )[0];
  const blowout = [...games].sort((a, b) =>
    Math.abs(Number(b.teams[0].points || 0) - Number(b.teams[1].points || 0)) -
    Math.abs(Number(a.teams[0].points || 0) - Number(a.teams[1].points || 0)),
  )[0];
  const allRegrets = rosters.flatMap((roster) =>
    rosterBenchRegrets(roster, matchupPages, players).slice(0, 1).map((regret) => ({ roster, regret })),
  ).sort((a, b) => b.regret.swing - a.regret.swing);
  const topRegret = allRegrets[0];

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} ${league.season} Receipts`)
    .setColor(0x00ceb8)
    .addFields(
      {
        name: "Closest Call",
        value: closest
          ? `P${closest.period}: ${teamLabel(rosterMap.get(closest.teams[0].roster_id), userMap)} ${shortNumber(closest.teams[0].points)} vs ${teamLabel(rosterMap.get(closest.teams[1].roster_id), userMap)} ${shortNumber(closest.teams[1].points)}`
          : "No data.",
        inline: false,
      },
      {
        name: "Biggest Blowout",
        value: blowout
          ? `P${blowout.period}: ${teamLabel(rosterMap.get(blowout.teams[0].roster_id), userMap)} ${shortNumber(blowout.teams[0].points)} vs ${teamLabel(rosterMap.get(blowout.teams[1].roster_id), userMap)} ${shortNumber(blowout.teams[1].points)}`
          : "No data.",
        inline: false,
      },
      {
        name: "Bench Regret",
        value: topRegret
          ? `${teamLabel(topRegret.roster, userMap)} left ${compactPlayerLabel(topRegret.regret.playerId, players)} on the bench in P${topRegret.regret.period} (${shortNumber(topRegret.regret.points)} pts, +${shortNumber(topRegret.regret.swing)} swing).`
          : "No bench regret data.",
        inline: false,
      },
    );
  applySeasonFooter(embed, league, interaction);

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
    .setTitle(`${league.name} ${league.season} Team Compare`)
    .setColor(0x00ceb8)
    .addFields(
      { name: teamLabel(teamA, userMap), value: line(teamA), inline: true },
      { name: teamLabel(teamB, userMap), value: line(teamB), inline: true },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
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
  awards: handleAwards,
  compare: handleCompare,
  connect: handleConnect,
  draft: handleDraft,
  history: handleHistory,
  league: handleLeague,
  leaders: handleLeaders,
  matchups: handleMatchups,
  playoffs: handlePlayoffs,
  power: handlePower,
  receipts: handleReceipts,
  recap: handleRecap,
  roster: handleRoster,
  standings: handleStandings,
  team: handleTeam,
  transactions: handleTransactions,
  weeklyhighs: handleWeeklyHighs,
};

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (["roster", "team", "compare"].includes(interaction.commandName)) {
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
