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
  formatRecord,
  managerName,
  playerLabel,
  rosterChoiceName,
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

function regularSeasonLastPeriod(league) {
  const scored = league.settings?.last_scored_leg || league.settings?.leg || 1;
  const playoffStart = league.settings?.playoff_week_start;
  if (playoffStart && playoffStart > 1) {
    return Math.min(scored, playoffStart - 1);
  }
  return scored;
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

function statValue(stats = {}, key) {
  return Number(stats[key] || 0);
}

function statAverage(stats = {}, key, games) {
  if (!games) return 0;
  return statValue(stats, key) / games;
}

function fixedNumber(value, decimals = 1) {
  const number = Number(value || 0);
  return number.toFixed(decimals).replace(/\.0$/, "");
}

function rankIcon(index) {
  return ["1.", "2.", "3."][index] || `${index + 1}.`;
}

function statPill(label, value) {
  return `**${label}:** ${value}`;
}

function joinPills(items) {
  return items.filter(Boolean).join("  |  ");
}

function playerSummaryLine(playerId, players, detail) {
  return `**${compactPlayerName(playerId, players, 24)}**${detail ? ` - ${detail}` : ""}`;
}

function analysisLine(analysis, players) {
  return playerSummaryLine(
    analysis.playerId,
    players,
    `${fixedNumber(analysis.seasonAvg)} avg, ${fixedNumber(analysis.recentAvg)} recent, ${marketLabel(analysis.marketStatus)}`,
  );
}

function compactName(value, maxLength = 14) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}.` : text;
}

function compactTeamName(roster, userMap, maxLength = 14) {
  return compactName(teamLabel(roster, userMap), maxLength);
}

function compactPlayerName(playerId, players, maxLength = 18) {
  return compactName(playerName(playerId, players), maxLength);
}

function rosterPowerRow(roster, userMap, index, rosters, analytics) {
  return `${rankIcon(index)} **${teamLabel(roster, userMap)}** - ${joinPills([
    statPill("Rec", formatRecord(roster.settings)),
    statPill("Pts", fixedNumber(settingPoints(roster.settings, "fpts"))),
    statPill("Power", teamPowerScore(roster, rosters, analytics)),
  ])}`;
}

function playerFantasyRow(playerId, points, players, index) {
  return `${rankIcon(index)} ${playerSummaryLine(playerId, players, `${fixedNumber(points)} fantasy`)}`;
}

function topPlayersForMatchup(matchup, players, limit = 3) {
  return Object.entries(matchup?.players_points || {})
    .filter(([playerId]) => playerId && playerId !== "0")
    .map(([playerId, points]) => ({ playerId, points: Number(points || 0), started: matchup.starters?.includes(playerId) || false }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit)
    .map((item) => `${item.started ? "S" : "B"} ${compactPlayerName(item.playerId, players, 18)} ${fixedNumber(item.points)}`);
}

function matchupTopPlayer(matchup, players) {
  return topPlayersForMatchup(matchup, players, 1)[0] || "-";
}

function rosterPlayerRows(playerIds, players, role, limit = 16) {
  return playerIds.slice(0, limit).map((playerId, index) => {
    const player = players[playerId] || {};
    return `${rankIcon(index)} **${compactPlayerName(playerId, players, 22)}** - ${role} - ${player.position || player.fantasy_positions?.[0] || "-"} / ${player.team || "FA"}`;
  });
}

function fantasyScoreFromStats(stats = {}, scoringSettings = {}) {
  return Object.entries(scoringSettings).reduce((total, [key, value]) => {
    if (typeof stats[key] !== "number") return total;
    return total + stats[key] * Number(value || 0);
  }, 0);
}

function projectionRow(projection, league) {
  if (!projection) return null;
  const fantasy = projection.fpts ?? fantasyScoreFromStats(projection, league.scoring_settings);
  return [
    fixedNumber(fantasy),
    fixedNumber(statValue(projection, "pts")),
    fixedNumber(statValue(projection, "reb")),
    fixedNumber(statValue(projection, "ast")),
    fixedNumber(statValue(projection, "stl")),
    fixedNumber(statValue(projection, "blk")),
    fixedNumber(statValue(projection, "tpm")),
  ];
}

function averageStatSummary(totals, games) {
  return joinPills([
    statPill("PTS", fixedNumber(statAverage(totals, "pts", games))),
    statPill("REB", fixedNumber(statAverage(totals, "reb", games))),
    statPill("AST", fixedNumber(statAverage(totals, "ast", games))),
    statPill("STL", fixedNumber(statAverage(totals, "stl", games))),
    statPill("BLK", fixedNumber(statAverage(totals, "blk", games))),
    statPill("3PM", fixedNumber(statAverage(totals, "tpm", games))),
  ]);
}

function weeklyLine(item) {
  return `P${item.period}: **${fixedNumber(item.fantasyPoints)}** fantasy - ${item.started ? "Started" : "Bench"} - ${joinPills([
    statPill("PTS", fixedNumber(statValue(item.stats, "pts"), 0)),
    statPill("REB", fixedNumber(statValue(item.stats, "reb"), 0)),
    statPill("AST", fixedNumber(statValue(item.stats, "ast"), 0)),
  ])}`;
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

function sortedStandings(rosters) {
  return [...rosters].sort((a, b) => {
    const winDiff = (b.settings?.wins || 0) - (a.settings?.wins || 0);
    if (winDiff) return winDiff;
    return settingPoints(b.settings, "fpts") - settingPoints(a.settings, "fpts");
  });
}

async function getAllPeriodMatchups(league) {
  const lastPeriod = regularSeasonLastPeriod(league);
  const periods = Array.from({ length: lastPeriod }, (_, index) => index + 1);
  const pages = await Promise.all(periods.map((period) => sleeper.getMatchups(league.league_id, period)));
  return periods.map((period, index) => ({ period, matchups: pages[index] || [] }));
}

async function getAllPeriodTransactions(league) {
  const lastPeriod = regularSeasonLastPeriod(league);
  const periods = Array.from({ length: lastPeriod }, (_, index) => index + 1);
  const pages = await Promise.all(periods.map((period) => sleeper.getTransactions(league.league_id, period)));
  return periods.map((period, index) => ({ period, transactions: pages[index] || [] }));
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

  const lastPeriod = regularSeasonLastPeriod(league);
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
  return regularSeasonLastPeriod(league);
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

function averageFantasy(weekly = []) {
  return weekly.length
    ? weekly.reduce((sum, item) => sum + Number(item.fantasyPoints || 0), 0) / weekly.length
    : 0;
}

function recentFantasy(weekly = [], count = 5) {
  return averageFantasy(weekly.slice(-count));
}

function ageScore(player = {}) {
  const age = Number(player.age || 0);
  if (!age) return 8;
  if (age <= 22) return 18;
  if (age <= 25) return 16;
  if (age <= 28) return 12;
  if (age <= 31) return 7;
  return 3;
}

function playerRisk(player = {}, weekly = []) {
  if (player.injury_status) return "injury";
  if (weekly.length < 5) return "thin data";
  if (ageScore(player) <= 4) return "age";
  return "normal";
}

function playerMarketStatus(seasonAvg, recentAvg, projection = null) {
  const projectedFantasy = projection?.fpts;
  if (seasonAvg >= 1 && recentAvg <= seasonAvg * 0.78 && (projectedFantasy == null || projectedFantasy >= recentAvg)) return "buy_low";
  if (seasonAvg >= 1 && recentAvg >= seasonAvg * 1.3) return "sell_high";
  if (seasonAvg < 8 && recentAvg < 8) return "fade";
  return "hold";
}

function marketLabel(status) {
  const labels = {
    buy_low: "Buy Low",
    fade: "Fade",
    hold: "Hold",
    sell_high: "Sell High",
  };
  return labels[status] || "Hold";
}

function dynastyTag(player = {}, seasonAvg = 0, recentAvg = 0) {
  const age = Number(player.age || 0);
  if (seasonAvg >= 35 && age && age <= 28) return "Elite cornerstone";
  if (seasonAvg >= 28 && age && age <= 30) return "Prime producer";
  if (seasonAvg >= 24 && age >= 31) return "Win-now veteran";
  if (recentAvg > seasonAvg * 1.2 && age && age <= 25) return "Rising asset";
  if (seasonAvg < 10 && age && age <= 23) return "Stash";
  if (seasonAvg < 10 && age >= 30) return "Declining risk";
  return "Depth piece";
}

function pickValue(pick, mode = "blend") {
  const values = {
    first: { short: 2, long: 24, blend: 13 },
    first_second: { short: 3, long: 34, blend: 19 },
    none: { short: 0, long: 0, blend: 0 },
    second: { short: 1, long: 11, blend: 6 },
    third: { short: 0, long: 5, blend: 3 },
  };
  return values[pick || "none"]?.[mode] ?? 0;
}

function pickLabel(pick) {
  const labels = {
    first: "1st",
    first_second: "1st + 2nd",
    none: "No pick",
    second: "2nd",
    third: "3rd",
  };
  return labels[pick || "none"] || "No pick";
}

function playerTradeValues(analysis) {
  const projection = analysis.projection?.fpts ?? analysis.recentAvg;
  const shortTerm = analysis.seasonAvg * 1.6 + analysis.recentAvg * 1.2 + projection * 0.8;
  const longTerm = shortTerm * 0.55 + ageScore(analysis.player) * 2.2 - (analysis.player.injury_status ? 8 : 0);
  return {
    blend: shortTerm * 0.6 + longTerm * 0.4,
    longTerm,
    shortTerm,
  };
}

async function getLeagueAnalytics(league, rosters, players) {
  const matchupPages = await getAllPeriodMatchups(league);
  const currentPeriod = lastScoredPeriod(league);
  const periods = Array.from({ length: currentPeriod }, (_, index) => index + 1);
  const [projections, statsPages] = await Promise.all([
    optionalSleeperCall(
      () => sleeper.getProjections(league.sport || "nfl", league.season, currentPeriod),
      {},
    ),
    Promise.all(periods.map((period) =>
      optionalSleeperCall(
        async () => ({ period, stats: await sleeper.getStats(league.sport || "nfl", league.season, period) }),
        { period, stats: {} },
      ),
    )),
  ]);
  const rosteredIds = [...new Set(rosters.flatMap((roster) => roster.players || []))]
    .filter((playerId) => playerId && playerId !== "0");
  const byPlayer = new Map();

  for (const playerId of rosteredIds) {
    const weekly = [];
    const totals = {};
    let starts = 0;

    for (const { period, matchups } of matchupPages) {
      const matchup = matchups.find((item) => Object.prototype.hasOwnProperty.call(item.players_points || {}, playerId));
      const stats = statsPages.find((page) => page.period === period)?.stats?.[playerId] || {};
      for (const [key, value] of Object.entries(stats)) {
        if (typeof value === "number") {
          totals[key] = (totals[key] || 0) + value;
        }
      }
      if (!matchup) continue;
      const started = matchup.starters?.includes(playerId) || false;
      if (started) starts += 1;
      weekly.push({
        fantasyPoints: Number(matchup.players_points[playerId] || 0),
        period,
        rosterId: matchup.roster_id,
        started,
        stats,
      });
    }

    const player = players[playerId] || {};
    const seasonAvg = averageFantasy(weekly);
    const recentAvg = recentFantasy(weekly);
    const projection = projections?.[playerId] || null;
    const status = playerMarketStatus(seasonAvg, recentAvg, projection);
    const analysis = {
      dynastyTag: dynastyTag(player, seasonAvg, recentAvg),
      marketStatus: status,
      player,
      playerId,
      projection,
      recentAvg,
      risk: playerRisk(player, weekly),
      seasonAvg,
      starts,
      totals,
      weekly,
    };
    analysis.values = playerTradeValues(analysis);
    byPlayer.set(playerId, analysis);
  }

  return { byPlayer, matchupPages, projections };
}

function categoryAveragesForRoster(roster, analytics) {
  const totals = {};
  let count = 0;

  for (const playerId of roster.players || []) {
    const analysis = analytics.byPlayer.get(playerId);
    if (!analysis?.weekly.length) continue;
    count += 1;
    const games = analysis.weekly.length;
    for (const key of ["pts", "reb", "ast", "stl", "blk", "tpm", "to"]) {
      totals[key] = (totals[key] || 0) + statAverage(analysis.totals, key, games);
    }
  }

  return { count, totals };
}

function categoryLabel(key) {
  const labels = { ast: "AST", blk: "BLK", fit: "Best Fit", pts: "PTS", reb: "REB", stl: "STL", to: "TO", tpm: "3PM", win_now: "Win Now", youth: "Youth" };
  return labels[key] || key.toUpperCase();
}

function teamNeeds(roster, rosters, analytics) {
  const profiles = rosters.map((item) => ({ roster: item, profile: categoryAveragesForRoster(item, analytics) }));
  const current = profiles.find((item) => item.roster.roster_id === roster.roster_id)?.profile;
  if (!current?.count) return ["fit"];

  const averages = {};
  for (const key of ["pts", "reb", "ast", "stl", "blk", "tpm"]) {
    averages[key] = profiles.reduce((sum, item) => sum + Number(item.profile.totals[key] || 0), 0) / Math.max(profiles.length, 1);
  }

  return Object.entries(averages)
    .map(([key, leagueAvg]) => ({ key, gap: leagueAvg - Number(current.totals[key] || 0) }))
    .filter((item) => item.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3)
    .map((item) => item.key);
}

function teamPowerScore(roster, rosters, analytics) {
  const standings = sortedStandings(rosters);
  const maxFpts = Math.max(...rosters.map((item) => settingPoints(item.settings, "fpts")), 1);
  const maxPpts = Math.max(...rosters.map((item) => settingPoints(item.settings, "ppts")), 1);
  const recordGames = (roster.settings?.wins || 0) + (roster.settings?.losses || 0) + (roster.settings?.ties || 0);
  const winPct = recordGames ? ((roster.settings?.wins || 0) + (roster.settings?.ties || 0) * 0.5) / recordGames : 0;
  const rankScore = 1 - standings.findIndex((item) => item.roster_id === roster.roster_id) / Math.max(standings.length - 1, 1);
  const recent = (roster.players || [])
    .map((playerId) => analytics.byPlayer.get(playerId)?.recentAvg || 0)
    .sort((a, b) => b - a)
    .slice(0, 8)
    .reduce((sum, value) => sum + value, 0);
  const maxRecent = Math.max(...rosters.map((item) => (item.players || [])
    .map((playerId) => analytics.byPlayer.get(playerId)?.recentAvg || 0)
    .sort((a, b) => b - a)
    .slice(0, 8)
    .reduce((sum, value) => sum + value, 0)), 1);

  return Math.round(100 * (
    (settingPoints(roster.settings, "fpts") / maxFpts) * 0.35 +
    winPct * 0.2 +
    (settingPoints(roster.settings, "ppts") / maxPpts) * 0.15 +
    (recent / maxRecent) * 0.15 +
    rankScore * 0.15
  ));
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
  const players = await sleeper.getPlayers(league.sport || "nfl");
  const analytics = await getLeagueAnalytics(league, rosters, players);
  const standings = sortedStandings(rosters);
  const lines = standings.map((roster, index) => rosterPowerRow(roster, userMap, index, rosters, analytics));
  const leader = standings[0];
  const powerLeader = [...standings].sort((a, b) => teamPowerScore(b, rosters, analytics) - teamPowerScore(a, rosters, analytics))[0];

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Standings"))
    .setColor(0x00ceb8)
    .setDescription(leader
      ? `Leader: **${teamLabel(leader, userMap)}** | Power: **${teamLabel(powerLeader, userMap)}**`
      : "No rosters found.")
    .addFields({ name: "Power Board", value: trimValue(lines.join("\n")), inline: false });
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleMatchups(interaction) {
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const week = await currentWeek(league, interaction.options.getInteger("week"));
  const [matchups, players] = await Promise.all([
    sleeper.getMatchups(league.league_id, week),
    sleeper.getPlayers(league.sport || "nfl"),
  ]);
  const rosterMap = byRosterId(rosters);
  const userMap = byUserId(users);
  const grouped = new Map();

  for (const matchup of matchups) {
    if (!grouped.has(matchup.matchup_id)) grouped.set(matchup.matchup_id, []);
    grouped.get(matchup.matchup_id).push(matchup);
  }

  const rows = [...grouped.values()].map((teams) => {
    const sorted = teams.sort((a, b) => (b.points || 0) - (a.points || 0));
    const [winner, loser] = sorted;
    if (!loser) {
      return `**${teamLabel(rosterMap.get(winner.roster_id), userMap)}** - ${fixedNumber(winner.points)} pts\nTop: ${matchupTopPlayer(winner, players)}`;
    }

    const margin = Number(winner.points || 0) - Number(loser.points || 0);
    return `**${teamLabel(rosterMap.get(winner.roster_id), userMap)}** ${fixedNumber(winner.points)} over **${teamLabel(rosterMap.get(loser.roster_id), userMap)}** ${fixedNumber(loser.points)}\nMargin: +${fixedNumber(margin)} | Top: ${matchupTopPlayer(winner, players)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, `Matchups - Period ${week}`))
    .setColor(0x00ceb8)
    .setDescription(rows.length ? "Winner, score, opponent, margin, and top player." : `No matchups found for period ${week}. League status: ${league.status || "unknown"}.`);
  if (rows.length) {
    embed.addFields({
      name: "Scoreboard",
      value: trimValue(rows.join("\n\n")),
      inline: false,
    });
  }
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
  const starterRows = (roster.starters || [])
    .map((playerId, index) => {
      const slot = starterSlots[index] || "S";
      if (!playerId || playerId === "0") return `${rankIcon(index)} **Empty** - ${slot}`;
      const player = players[playerId] || {};
      return `${rankIcon(index)} **${compactPlayerName(playerId, players, 22)}** - ${slot} - ${player.position || player.fantasy_positions?.[0] || "-"} / ${player.team || "FA"}`;
    });
  const benchIds = rosterPlayers
    .filter((playerId) => !starters.has(playerId) && !reserve.has(playerId) && !taxi.has(playerId))
    .slice(0, 16);
  const benchRows = rosterPlayerRows(benchIds, players, "B", 16);
  const taxiRows = rosterPlayerRows([...taxi], players, "T", 10);
  const reserveRows = rosterPlayerRows([...reserve], players, "IR", 10);
  const summary = [
    `Record: **${formatRecord(roster.settings)}** | Points: **${shortNumber(settingPoints(roster.settings, "fpts"))}** | Potential: **${shortNumber(settingPoints(roster.settings, "ppts"))}**`,
    `${rosterPlayers.length} players | ${starterIds.length} starters | ${benchIds.length} bench | ${taxi.size} taxi | ${reserve.size} reserve`,
  ].join("\n");
  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, managerName(user)))
    .setColor(0x00ceb8)
    .setDescription(summary)
    .addFields(
      {
        name: "Starters",
        value: starterRows.length
          ? trimValue(starterRows.join("\n"))
          : "No starters set.",
        inline: false,
      },
      {
        name: "Bench",
        value: benchRows.length
          ? trimValue(benchRows.join("\n"))
          : "No bench players.",
        inline: false,
      },
    )
    .setFooter({ text: `${user?.display_name || "Unknown Manager"} - Roster ${roster.roster_id}` });

  if (taxiRows.length) {
    embed.addFields({ name: "Taxi", value: trimValue(taxiRows.join("\n")), inline: false });
  }

  if (reserveRows.length) {
    embed.addFields({ name: "Reserve", value: trimValue(reserveRows.join("\n")), inline: false });
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

    const movement = [
      added.length ? `+ ${added.map((name) => compactName(name, 28)).join(", ")}` : null,
      dropped.length ? `- ${dropped.map((name) => compactName(name, 28)).join(", ")}` : null,
    ].filter(Boolean).join("\n");
    lines.push(`**${teamNameForRoster(rosterId, rosterMap, userMap)}**\n${movement}`);
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

async function handleLeaders(interaction) {
  const stat = interaction.options.getString("stat", true);
  const { league } = await getSeasonBundle(interaction, { preferCompleted: true });
  const players = await sleeper.getPlayers(league.sport || "nfl");
  const leaders = await statLeaders(league, stat);
  const statLabel = statName(stat);
  const rows = leaders.slice(0, 12).map((leader, index) => playerFantasyRow(leader.playerId, leader.total, players, index));

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, `${statLabel} Leaders`))
    .setColor(0x00ceb8)
    .setDescription(rows.length ? `Top ${statLabel.toLowerCase()} players for this season.` : "No data.")
    .addFields({
      name: "Leaderboard",
      value: rows.length ? trimValue(rows.join("\n")) : "No data.",
      inline: false,
    });

  if (stat !== "fantasy") {
    embed.setFooter({ text: `${seasonFooter(league, requestedSeason(interaction))} Stats use Sleeper's stats endpoint.` });
  } else {
    applySeasonFooter(embed, league, interaction);
  }

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
  const analytics = await getLeagueAnalytics(league, rosters, players);
  const userMap = byUserId(users);
  const txCount = transactionPages.reduce((sum, page) =>
    sum + page.transactions.filter((tx) => (tx.roster_ids || []).includes(roster.roster_id)).length, 0);
  const weeklyScores = matchupPages
    .map(({ period, matchups }) => ({ period, matchup: matchups.find((item) => item.roster_id === roster.roster_id) }))
    .filter((item) => item.matchup);
  const bestWeek = [...weeklyScores].sort((a, b) => Number(b.matchup.points || 0) - Number(a.matchup.points || 0))[0];
  const regrets = rosterBenchRegrets(roster, matchupPages, players);
  const playerTotals = fantasyLeadersFromMatchups(
    weeklyScores.map((item) => ({ period: item.period, matchups: [item.matchup] })),
  ).slice(0, 8);
  const needs = teamNeeds(roster, rosters, analytics);
  const power = teamPowerScore(roster, rosters, analytics);
  const rosterAnalyses = (roster.players || [])
    .map((playerId) => analytics.byPlayer.get(playerId))
    .filter(Boolean)
    .sort((a, b) => b.values.blend - a.values.blend);
  const tradeChip = rosterAnalyses.find((item) => item.values.blend >= 20 && item.marketStatus === "sell_high") || rosterAnalyses[2] || rosterAnalyses[0];
  const replaceable = [...rosterAnalyses].reverse().find((item) => item.weekly.length >= 3) || rosterAnalyses[rosterAnalyses.length - 1];
  const rosterType = power >= 85 ? "Contender" : power >= 72 ? "Fringe contender" : power >= 58 ? "Middle trap" : "Rebuilder";
  const strengths = ["pts", "reb", "ast", "stl", "blk", "tpm"]
    .filter((key) => !needs.includes(key))
    .slice(0, 3);
  const recentRows = weeklyScores.slice(-5).map((item) =>
    `P${item.period}: **${fixedNumber(item.matchup.points)}** pts - ${topPlayersForMatchup(item.matchup, players, 1)[0] || "-"}`,
  );

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, teamLabel(roster, userMap)))
    .setColor(0x00ceb8)
    .addFields(
      {
        name: "Snapshot",
        value: [
          `Record: **${formatRecord(roster.settings)}**`,
          `Points: **${shortNumber(settingPoints(roster.settings, "fpts"))}**`,
          `Potential: **${shortNumber(settingPoints(roster.settings, "ppts"))}**`,
          `Against: **${shortNumber(settingPoints(roster.settings, "fpts_against"))}**`,
          `Power: **${power}** | Type: **${rosterType}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Roster Read",
        value: [
          `Strengths: ${strengths.map(categoryLabel).join(", ") || "None obvious"}`,
          `Needs: ${needs.map(categoryLabel).join(", ") || "Best player available"}`,
          `Trade chip: ${tradeChip ? compactPlayerName(tradeChip.playerId, players, 18) : "N/A"}`,
          `Replaceable: ${replaceable ? compactPlayerName(replaceable.playerId, players, 18) : "N/A"}`,
          `Moves: ${roster.settings?.total_moves ?? 0} | Transactions: ${txCount}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Best Week",
        value: bestWeek ? `Period ${bestWeek.period}: ${shortNumber(bestWeek.matchup.points)} points` : "No matchup data.",
        inline: true,
      },
      {
        name: "Top Players",
        value: playerTotals.length
          ? trimValue(playerTotals.map((item, index) => playerFantasyRow(item.playerId, item.total, players, index)).join("\n"))
          : "No player data.",
        inline: false,
      },
      {
        name: "Recent Weeks",
        value: recentRows.length ? trimValue(recentRows.join("\n")) : "No matchup data.",
        inline: false,
      },
      {
        name: "Bench Regrets",
        value: regrets.length
          ? trimValue(regrets.slice(0, 5).map((regret) =>
            `P${regret.period}: **${compactName(regret.label, 24)}** - ${fixedNumber(regret.points)} pts, ${fixedNumber(regret.swing)} left`,
          ).join("\n"))
          : "No obvious bench misses.",
        inline: false,
      },
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
  const games = snapshot.weekly.length;
  const starts = snapshot.weekly.filter((item) => item.started).length;
  const fantasyAverage = games ? snapshot.fantasyTotal / games : 0;
  const recentAvg = recentFantasy(snapshot.weekly);
  const tag = dynastyTag(player, fantasyAverage, recentAvg);
  const marketStatus = playerMarketStatus(fantasyAverage, recentAvg, projection);
  const gamesWithStats = snapshot.weekly.filter((item) => Object.keys(item.stats || {}).length).length || games;
  const shownWeeks = selectedPeriod
    ? snapshot.weekly.filter((item) => item.period === selectedPeriod)
    : snapshot.weekly.slice(-5);
  const averageTable = gamesWithStats
    ? averageStatSummary(snapshot.totals, gamesWithStats)
    : "No box-score stats found.";
  const gameLog = shownWeeks.length
    ? shownWeeks.map(weeklyLine).join("\n")
    : "No weekly stat data found for this player.";
  const projected = projectionRow(projection, league);
  const projectionLine = projected
    ? joinPills([
      statPill("Fantasy", projected[0]),
      statPill("PTS", projected[1]),
      statPill("REB", projected[2]),
      statPill("AST", projected[3]),
      statPill("STL", projected[4]),
      statPill("BLK", projected[5]),
      statPill("3PM", projected[6]),
    ])
    : "No projection available.";
  const cacheText = previousCache?.updatedAt ? "Cache refreshed" : "Cached";

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, playerName(playerId, players)))
    .setColor(0x00ceb8)
    .setDescription(`${playerBioLine(playerId, players)}\nRostered by: **${manager}**`)
    .addFields(
      {
        name: "Snapshot",
        value: [
          `Fantasy: **${shortNumber(snapshot.fantasyTotal)}** total | **${fixedNumber(fantasyAverage)}** avg`,
          `Recent: **${fixedNumber(recentAvg)}** | Games: **${games}** | Starts: **${starts}**`,
          `Dynasty: **${tag}** | Market: **${marketLabel(marketStatus)}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Per-Game Stats",
        value: averageTable,
        inline: false,
      },
      {
        name: selectedPeriod ? `Period ${selectedPeriod}` : "Recent Game Log",
        value: trimValue(gameLog, "No weekly stat data found for this player.", 1000),
        inline: false,
      },
      {
        name: `Projection - Period ${projectionPeriod}`,
        value: projectionLine,
        inline: false,
      },
    )
    .setFooter({ text: `${seasonFooter(league, requestedSeason(interaction))} ${cacheText}: ${cached.weekly.length} weeks saved locally.` });

  await interaction.editReply({ embeds: [embed] });
}

async function handleCompare(interaction) {
  const playerAId = interaction.options.getString("player_a", true);
  const playerBId = interaction.options.getString("player_b", true);
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const players = await sleeper.getPlayers(league.sport || "nfl");
  const playerA = players[playerAId];
  const playerB = players[playerBId];

  if (!playerA || !playerB) {
    await interaction.editReply("Could not find both players. Pick from autocomplete suggestions.");
    return;
  }

  const userMap = byUserId(users);
  const rosterForPlayer = (playerId) => rosters.find((roster) => (roster.players || []).includes(playerId));
  const rosterA = rosterForPlayer(playerAId);
  const rosterB = rosterForPlayer(playerBId);
  const [snapshotA, snapshotB] = await Promise.all([
    playerSeasonSnapshot(league, playerAId),
    playerSeasonSnapshot(league, playerBId),
  ]);
  const gamesA = snapshotA.weekly.length;
  const gamesB = snapshotB.weekly.length;
  const startsA = snapshotA.weekly.filter((item) => item.started).length;
  const startsB = snapshotB.weekly.filter((item) => item.started).length;
  const gamesWithStatsA = snapshotA.weekly.filter((item) => Object.keys(item.stats || {}).length).length || gamesA;
  const gamesWithStatsB = snapshotB.weekly.filter((item) => Object.keys(item.stats || {}).length).length || gamesB;
  const playerALine = joinPills([
    statPill("Fantasy", fixedNumber(snapshotA.fantasyTotal)),
    statPill("Avg", fixedNumber(gamesA ? snapshotA.fantasyTotal / gamesA : 0)),
    statPill("Games", gamesA),
    statPill("Starts", startsA),
  ]);
  const playerBLine = joinPills([
    statPill("Fantasy", fixedNumber(snapshotB.fantasyTotal)),
    statPill("Avg", fixedNumber(gamesB ? snapshotB.fantasyTotal / gamesB : 0)),
    statPill("Games", gamesB),
    statPill("Starts", startsB),
  ]);

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Player Compare"))
    .setColor(0x00ceb8)
    .setDescription([
      `**${playerName(playerAId, players)}** - ${playerBioLine(playerAId, players)} - ${rosterA ? teamLabel(rosterA, userMap) : "Free Agent"}`,
      `**${playerName(playerBId, players)}** - ${playerBioLine(playerBId, players)} - ${rosterB ? teamLabel(rosterB, userMap) : "Free Agent"}`,
    ].join("\n"))
    .addFields(
      {
        name: playerName(playerAId, players),
        value: `${playerALine}\n${averageStatSummary(snapshotA.totals, gamesWithStatsA)}`,
        inline: false,
      },
      {
        name: playerName(playerBId, players),
        value: `${playerBLine}\n${averageStatSummary(snapshotB.totals, gamesWithStatsB)}`,
        inline: false,
      },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

function tradeSideFromOptions(interaction, prefix) {
  return ["1", "2", "3"]
    .map((index) => interaction.options.getString(`${prefix}${index}`))
    .filter(Boolean);
}

function tradeSideValue(playerIds, pick, analytics, mode) {
  return playerIds.reduce((sum, playerId) => sum + Number(analytics.byPlayer.get(playerId)?.values?.[mode] || 0), 0) + pickValue(pick, mode);
}

function tradeSideLabel(playerIds, pick, players) {
  const playerNames = playerIds.map((playerId) => compactPlayerName(playerId, players, 20));
  if (pick && pick !== "none") playerNames.push(pickLabel(pick));
  return playerNames.join(", ") || "No assets";
}

function winnerLabel(diff, labelA = "Side A", labelB = "Side B") {
  if (Math.abs(diff) < 5) return "Even";
  return diff > 0 ? labelA : labelB;
}

async function handleTrade(interaction) {
  const { league, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const players = await sleeper.getPlayers(league.sport || "nfl");
  const analytics = await getLeagueAnalytics(league, rosters, players);
  const sideA = tradeSideFromOptions(interaction, "a");
  const sideB = tradeSideFromOptions(interaction, "b");
  const pickA = interaction.options.getString("a_pick") || "none";
  const pickB = interaction.options.getString("b_pick") || "none";

  if (!sideA.length || !sideB.length) {
    await interaction.editReply("Add at least one player to each side.");
    return;
  }

  const shortA = tradeSideValue(sideA, pickA, analytics, "shortTerm");
  const shortB = tradeSideValue(sideB, pickB, analytics, "shortTerm");
  const longA = tradeSideValue(sideA, pickA, analytics, "longTerm");
  const longB = tradeSideValue(sideB, pickB, analytics, "longTerm");
  const blendA = tradeSideValue(sideA, pickA, analytics, "blend");
  const blendB = tradeSideValue(sideB, pickB, analytics, "blend");
  const whoWins = winnerLabel(blendA - blendB);
  const shortWinner = winnerLabel(shortA - shortB);
  const longWinner = winnerLabel(longA - longB);
  const bestAssetA = sideA.map((playerId) => analytics.byPlayer.get(playerId)).filter(Boolean).sort((a, b) => b.values.blend - a.values.blend)[0];
  const bestAssetB = sideB.map((playerId) => analytics.byPlayer.get(playerId)).filter(Boolean).sort((a, b) => b.values.blend - a.values.blend)[0];
  const why = [
    whoWins === "Even"
      ? "The blended value is close enough that roster fit should decide it."
      : `${whoWins} has the stronger blended asset value.`,
    shortWinner !== longWinner ? `Short-term and long-term value split because picks/youth matter more over time.` : `Short-term and long-term point to the same side.`,
    bestAssetA && bestAssetB
      ? `Best assets: ${compactPlayerName(bestAssetA.playerId, players)} vs ${compactPlayerName(bestAssetB.playerId, players)}.`
      : null,
  ].filter(Boolean).join(" ");

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Trade Builder"))
    .setColor(0x00ceb8)
    .setDescription([
      `Side A: **${tradeSideLabel(sideA, pickA, players)}**`,
      `Side B: **${tradeSideLabel(sideB, pickB, players)}**`,
    ].join("\n"))
    .addFields(
      {
        name: "Verdict",
        value: [
          `Who wins: **${whoWins}**`,
          `Short term: **${shortWinner}**`,
          `Long term: **${longWinner}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Value Check",
        value: [
          `**Side A** - ${joinPills([statPill("Now", fixedNumber(shortA)), statPill("Long", fixedNumber(longA)), statPill("Value", fixedNumber(blendA))])}`,
          `**Side B** - ${joinPills([statPill("Now", fixedNumber(shortB)), statPill("Long", fixedNumber(longB)), statPill("Value", fixedNumber(blendB))])}`,
        ].join("\n"),
        inline: false,
      },
      { name: "Why", value: why, inline: false },
    );
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

async function handleMarket(interaction) {
  const mode = interaction.options.getString("mode") || "all";
  const teamQuery = interaction.options.getString("team");
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const players = await sleeper.getPlayers(league.sport || "nfl");
  const analytics = await getLeagueAnalytics(league, rosters, players);
  const roster = teamQuery ? findRosterByTeam(teamQuery, users, rosters) : null;
  const allowed = roster ? new Set(roster.players || []) : null;
  const groups = { buy_low: [], fade: [], hold: [], sell_high: [] };

  for (const analysis of analytics.byPlayer.values()) {
    if (allowed && !allowed.has(analysis.playerId)) continue;
    if (!analysis.weekly.length) continue;
    groups[analysis.marketStatus].push(analysis);
  }

  for (const list of Object.values(groups)) {
    list.sort((a, b) => Math.abs(b.recentAvg - b.seasonAvg) - Math.abs(a.recentAvg - a.seasonAvg));
  }

  const fieldFor = (status) => {
    const rows = groups[status].slice(0, 6).map((analysis, index) =>
      `${rankIcon(index)} ${analysisLine(analysis, players)}`,
    );
    return {
      inline: false,
      name: marketLabel(status),
      value: rows.length ? trimValue(rows.join("\n")) : "No strong signals.",
    };
  };
  const statuses = mode === "all" ? ["buy_low", "sell_high", "hold", "fade"] : [mode];
  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Market"))
    .setColor(0x00ceb8)
    .setDescription(roster ? `Filtered to **${teamLabel(roster, byUserId(users))}**.` : "Buy-low and sell-high signals from season vs recent form.");
  embed.addFields(statuses.map(fieldFor));
  applySeasonFooter(embed, league, interaction);

  await interaction.editReply({ embeds: [embed] });
}

function targetScoreForNeed(analysis, need) {
  if (need === "youth") return ageScore(analysis.player) + analysis.values.longTerm * 0.2;
  if (need === "win_now") return analysis.values.shortTerm;
  if (need && need !== "fit") {
    const games = analysis.weekly.length || 1;
    return statAverage(analysis.totals, need, games) * 10 + analysis.values.blend * 0.15;
  }
  return analysis.values.blend;
}

function rosterForPlayerId(playerId, rosters) {
  return rosters.find((roster) => (roster.players || []).includes(playerId));
}

function bestRosterAssetValue(roster, analytics) {
  return Math.max(...(roster.players || []).map((playerId) => analytics.byPlayer.get(playerId)?.values.blend || 0), 0);
}

function isTopRosterAsset(playerId, rosters, analytics, count = 2) {
  const ownerRoster = rosterForPlayerId(playerId, rosters);
  if (!ownerRoster) return false;
  const topIds = (ownerRoster.players || [])
    .map((id) => analytics.byPlayer.get(id))
    .filter(Boolean)
    .sort((a, b) => b.values.blend - a.values.blend)
    .slice(0, count)
    .map((analysis) => analysis.playerId);
  return topIds.includes(playerId);
}

function buildOfferForTarget(target, outgoingPool, aggression) {
  const multiplier = aggression === "overpay" ? 1.12 : aggression === "value" ? 0.88 : 1;
  const targetValue = target.values.blend * multiplier;
  const candidates = outgoingPool
    .filter((asset) => asset.playerId !== target.playerId)
    .sort((a, b) => b.values.blend - a.values.blend);
  const packages = [];

  for (const asset of candidates) {
    packages.push({ assets: [asset], value: asset.values.blend });
  }

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      packages.push({ assets: [candidates[i], candidates[j]], value: candidates[i].values.blend + candidates[j].values.blend });
    }
  }

  return packages
    .filter((pkg) => pkg.value >= targetValue * 0.78 && pkg.value <= targetValue * 1.25)
    .sort((a, b) => Math.abs(targetValue - a.value) - Math.abs(targetValue - b.value))[0] || packages
    .sort((a, b) => Math.abs(targetValue - a.value) - Math.abs(targetValue - b.value))[0];
}

async function handleTradeFinder(interaction) {
  const teamQuery = interaction.options.getString("team", true);
  const selectedNeed = interaction.options.getString("need") || "fit";
  const aggression = interaction.options.getString("aggression") || "fair";
  const { league, users, rosters } = await getSeasonBundle(interaction, { preferCompleted: true });
  const roster = findRosterByTeam(teamQuery, users, rosters);
  if (!roster) {
    await interaction.editReply("No team matched that choice.");
    return;
  }

  const players = await sleeper.getPlayers(league.sport || "nfl");
  const analytics = await getLeagueAnalytics(league, rosters, players);
  const userMap = byUserId(users);
  const needs = teamNeeds(roster, rosters, analytics);
  const need = selectedNeed === "fit" ? needs[0] || "fit" : selectedNeed;
  const ownIds = new Set(roster.players || []);
  const outgoingPool = [...ownIds]
    .map((playerId) => analytics.byPlayer.get(playerId))
    .filter(Boolean)
    .sort((a, b) => b.values.blend - a.values.blend);
  const maxOffer = outgoingPool.slice(0, 3).reduce((sum, asset) => sum + asset.values.blend, 0);
  const ownBest = bestRosterAssetValue(roster, analytics);
  const targets = [...analytics.byPlayer.values()]
    .filter((analysis) => {
      if (ownIds.has(analysis.playerId) || !analysis.weekly.length) return false;
      if (analysis.values.blend > maxOffer * 1.2) return false;
      if (aggression !== "overpay" && analysis.values.blend > ownBest * 1.15) return false;
      if (aggression !== "overpay" && isTopRosterAsset(analysis.playerId, rosters, analytics, 2)) return false;
      return analysis.seasonAvg >= 6;
    })
    .sort((a, b) => targetScoreForNeed(b, need) - targetScoreForNeed(a, need))
    .slice(0, 5);
  const rows = targets.map((target, index) => {
    const offer = buildOfferForTarget(target, outgoingPool, aggression);
    const owner = rosterForPlayerId(target.playerId, rosters);
    const offerText = offer?.assets?.length
      ? offer.assets.map((asset) => compactPlayerName(asset.playerId, players, 18)).join(" + ")
      : "Pick";
    return `${rankIcon(index)} **${compactPlayerName(target.playerId, players, 22)}** (${owner ? teamLabel(owner, userMap) : "FA"})\nOffer idea: ${offerText}\n${joinPills([
      statPill("Target", fixedNumber(target.values.blend)),
      statPill("Offer", fixedNumber(offer?.value || 0)),
      statPill("Fit", categoryLabel(need)),
    ])}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Trade Finder"))
    .setColor(0x00ceb8)
    .setDescription([
      `Team: **${teamLabel(roster, userMap)}**`,
      `Need: **${need === "fit" ? "Best Fit" : categoryLabel(need)}** | Aggression: **${aggression}**`,
    ].join("\n"))
    .addFields(
      {
        name: "Ideas",
        value: rows.length ? trimValue(rows.join("\n\n")) : "No realistic targets found. Try a different need or use aggression: overpay.",
        inline: false,
      },
      {
        name: "Why",
        value: `Filtered out most top-two roster assets unless aggression is overpay, then priced targets against packages your roster can actually offer.`,
        inline: false,
      },
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
  league: handleLeague,
  leaders: handleLeaders,
  market: handleMarket,
  matchups: handleMatchups,
  player: handlePlayer,
  roster: handleRoster,
  standings: handleStandings,
  team: handleTeam,
  trade: handleTrade,
  tradefinder: handleTradeFinder,
  transactions: handleTransactions,
};

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (["player", "compare", "trade"].includes(interaction.commandName)) {
      await handlePlayerAutocomplete(interaction);
    } else if (["roster", "team", "market", "tradefinder"].includes(interaction.commandName)) {
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
