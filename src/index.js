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

function percentage(made, attempted) {
  if (!attempted) return "-";
  return (made / attempted).toFixed(3).replace(/^0/, "");
}

function fixedNumber(value, decimals = 1) {
  const number = Number(value || 0);
  return number.toFixed(decimals).replace(/\.0$/, "");
}

function tableLine(values, widths) {
  return values.map((value, index) => String(value).padEnd(widths[index])).join(" ").trimEnd();
}

function codeTable(headers, rows, widths) {
  return `\`\`\`\n${tableLine(headers, widths)}\n${rows.map((row) => tableLine(row, widths)).join("\n")}\n\`\`\``;
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

function rosterSummaryRow(roster, userMap, index) {
  return [
    index + 1,
    compactTeamName(roster, userMap, 18),
    formatRecord(roster.settings),
    fixedNumber(settingPoints(roster.settings, "fpts")),
    fixedNumber(settingPoints(roster.settings, "ppts")),
  ];
}

function playerFantasyRow(playerId, points, players, index) {
  return [
    index + 1,
    compactPlayerName(playerId, players, 20),
    fixedNumber(points),
  ];
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
    return [
      index + 1,
      role,
      compactPlayerName(playerId, players, 20),
      player.position || player.fantasy_positions?.[0] || "-",
      player.team || "FA",
    ];
  });
}

function fantasyScoreFromStats(stats = {}, scoringSettings = {}) {
  return Object.entries(scoringSettings).reduce((total, [key, value]) => {
    if (typeof stats[key] !== "number") return total;
    return total + stats[key] * Number(value || 0);
  }, 0);
}

function playerAverageRow(totals, games) {
  return [
    fixedNumber(statAverage(totals, "pts", games)),
    fixedNumber(statAverage(totals, "reb", games)),
    fixedNumber(statAverage(totals, "ast", games)),
    fixedNumber(statAverage(totals, "stl", games)),
    fixedNumber(statAverage(totals, "blk", games)),
    fixedNumber(statAverage(totals, "tpm", games)),
    fixedNumber(statAverage(totals, "to", games)),
    percentage(statValue(totals, "fgm"), statValue(totals, "fga")),
    percentage(statValue(totals, "ftm"), statValue(totals, "fta")),
  ];
}

function playerGameLogRow(item) {
  return [
    `P${item.period}`,
    item.started ? "S" : "B",
    fixedNumber(item.fantasyPoints),
    fixedNumber(statValue(item.stats, "pts"), 0),
    fixedNumber(statValue(item.stats, "reb"), 0),
    fixedNumber(statValue(item.stats, "ast"), 0),
    fixedNumber(statValue(item.stats, "stl"), 0),
    fixedNumber(statValue(item.stats, "blk"), 0),
    fixedNumber(statValue(item.stats, "tpm"), 0),
  ];
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
  const standings = sortedStandings(rosters);
  const table = codeTable(
    ["#", "TEAM", "REC", "PTS", "POT"],
    standings.map((roster, index) => rosterSummaryRow(roster, userMap, index)),
    [3, 18, 7, 8, 8],
  );
  const leader = standings[0];

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Standings"))
    .setColor(0x00ceb8)
    .setDescription(leader
      ? `Leader: **${teamLabel(leader, userMap)}** | ${formatRecord(leader.settings)} | ${shortNumber(settingPoints(leader.settings, "fpts"))} pts`
      : "No rosters found.")
    .addFields({ name: "Table", value: table, inline: false });
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
      return [
        compactTeamName(rosterMap.get(winner.roster_id), userMap),
        fixedNumber(winner.points),
        "-",
        "-",
        matchupTopPlayer(winner, players),
      ];
    }

    const margin = Number(winner.points || 0) - Number(loser.points || 0);
    return [
      compactTeamName(rosterMap.get(winner.roster_id), userMap),
      fixedNumber(winner.points),
      compactTeamName(rosterMap.get(loser.roster_id), userMap),
      fixedNumber(loser.points),
      `+${fixedNumber(margin)} | ${matchupTopPlayer(winner, players)}`,
    ];
  });

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, `Matchups - Period ${week}`))
    .setColor(0x00ceb8)
    .setDescription(rows.length ? "Winner, score, opponent, margin, and top player." : `No matchups found for period ${week}. League status: ${league.status || "unknown"}.`);
  if (rows.length) {
    embed.addFields({
      name: "Scoreboard",
      value: codeTable(["WINNER", "PTS", "OPP", "OPPPTS", "NOTE"], rows, [14, 6, 14, 7, 28]),
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
      if (!playerId || playerId === "0") return [index + 1, slot, "Empty", "-", "-"];
      const player = players[playerId] || {};
      return [
        index + 1,
        slot,
        compactPlayerName(playerId, players, 20),
        player.position || player.fantasy_positions?.[0] || "-",
        player.team || "FA",
      ];
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
          ? codeTable(["#", "SLOT", "PLAYER", "POS", "TEAM"], starterRows, [3, 6, 20, 5, 5])
          : "No starters set.",
        inline: false,
      },
      {
        name: "Bench",
        value: benchRows.length
          ? codeTable(["#", "R", "PLAYER", "POS", "TEAM"], benchRows, [3, 3, 20, 5, 5])
          : "No bench players.",
        inline: false,
      },
    )
    .setFooter({ text: `${user?.display_name || "Unknown Manager"} - Roster ${roster.roster_id}` });

  if (taxiRows.length) {
    embed.addFields({ name: "Taxi", value: codeTable(["#", "R", "PLAYER", "POS", "TEAM"], taxiRows, [3, 3, 20, 5, 5]), inline: false });
  }

  if (reserveRows.length) {
    embed.addFields({ name: "Reserve", value: codeTable(["#", "R", "PLAYER", "POS", "TEAM"], reserveRows, [3, 3, 20, 5, 5]), inline: false });
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
      value: rows.length ? codeTable(["#", "PLAYER", stat === "fantasy" ? "FANT" : stat.toUpperCase()], rows, [3, 20, 8]) : "No data.",
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
  const userMap = byUserId(users);
  const txCount = transactionPages.reduce((sum, page) =>
    sum + page.transactions.filter((tx) => (tx.roster_ids || []).includes(roster.roster_id)).length, 0);
  const weeklyScores = matchupPages
    .map(({ period, matchups }) => ({ period, matchup: matchups.find((item) => item.roster_id === roster.roster_id) }))
    .filter((item) => item.matchup);
  const bestWeek = [...weeklyScores].sort((a, b) => Number(b.matchup.points || 0) - Number(a.matchup.points || 0))[0];
  const regrets = rosterBenchRegrets(roster, matchupPages, players);
  const potentialGap = settingPoints(roster.settings, "ppts") - settingPoints(roster.settings, "fpts");
  const playerTotals = fantasyLeadersFromMatchups(
    weeklyScores.map((item) => ({ period: item.period, matchups: [item.matchup] })),
  ).slice(0, 8);
  const recentRows = weeklyScores.slice(-5).map((item) => [
    `P${item.period}`,
    fixedNumber(item.matchup.points),
    topPlayersForMatchup(item.matchup, players, 1)[0] || "-",
  ]);

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
          `Streak: **${roster.metadata?.streak || "N/A"}**`,
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
        name: "Top Players",
        value: playerTotals.length
          ? codeTable(["#", "PLAYER", "FANT"], playerTotals.map((item, index) => playerFantasyRow(item.playerId, item.total, players, index)), [3, 20, 8])
          : "No player data.",
        inline: false,
      },
      {
        name: "Recent Weeks",
        value: recentRows.length ? codeTable(["WK", "PTS", "TOP PLAYER"], recentRows, [4, 7, 28]) : "No matchup data.",
        inline: false,
      },
      {
        name: "Bench Regrets",
        value: regrets.length
          ? codeTable(
            ["WK", "PLAYER", "PTS", "LEFT"],
            regrets.slice(0, 5).map((regret) => [`P${regret.period}`, compactName(regret.label, 20), fixedNumber(regret.points), fixedNumber(regret.swing)]),
            [4, 20, 6, 6],
          )
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
  const gamesWithStats = snapshot.weekly.filter((item) => Object.keys(item.stats || {}).length).length || games;
  const shownWeeks = selectedPeriod
    ? snapshot.weekly.filter((item) => item.period === selectedPeriod)
    : snapshot.weekly.slice(-5);
  const averageTable = gamesWithStats
    ? codeTable(
      ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "FG%", "FT%"],
      [playerAverageRow(snapshot.totals, gamesWithStats)],
      [5, 5, 5, 5, 5, 5, 4, 5, 5],
    )
    : "No box-score stats found.";
  const gameLog = shownWeeks.length
    ? codeTable(
      ["WK", "R", "FANT", "PTS", "REB", "AST", "STL", "BLK", "3PM"],
      shownWeeks.map(playerGameLogRow),
      [4, 2, 6, 4, 4, 4, 4, 4, 4],
    )
    : "No weekly stat data found for this player.";
  const projected = projectionRow(projection, league);
  const projectionLine = projected
    ? codeTable(
      ["FANT", "PTS", "REB", "AST", "STL", "BLK", "3PM"],
      [projected],
      [6, 5, 5, 5, 5, 5, 5],
    )
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
          `Games: **${games}** | Starts: **${starts}** | Role: **S=start, B=bench**`,
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
  const rows = [
    ["Fantasy", fixedNumber(snapshotA.fantasyTotal), fixedNumber(snapshotB.fantasyTotal)],
    ["Avg", fixedNumber(gamesA ? snapshotA.fantasyTotal / gamesA : 0), fixedNumber(gamesB ? snapshotB.fantasyTotal / gamesB : 0)],
    ["Games", gamesA, gamesB],
    ["Starts", startsA, startsB],
    ["PTS/G", fixedNumber(statAverage(snapshotA.totals, "pts", gamesWithStatsA)), fixedNumber(statAverage(snapshotB.totals, "pts", gamesWithStatsB))],
    ["REB/G", fixedNumber(statAverage(snapshotA.totals, "reb", gamesWithStatsA)), fixedNumber(statAverage(snapshotB.totals, "reb", gamesWithStatsB))],
    ["AST/G", fixedNumber(statAverage(snapshotA.totals, "ast", gamesWithStatsA)), fixedNumber(statAverage(snapshotB.totals, "ast", gamesWithStatsB))],
    ["STL/G", fixedNumber(statAverage(snapshotA.totals, "stl", gamesWithStatsA)), fixedNumber(statAverage(snapshotB.totals, "stl", gamesWithStatsB))],
    ["BLK/G", fixedNumber(statAverage(snapshotA.totals, "blk", gamesWithStatsA)), fixedNumber(statAverage(snapshotB.totals, "blk", gamesWithStatsB))],
    ["3PM/G", fixedNumber(statAverage(snapshotA.totals, "tpm", gamesWithStatsA)), fixedNumber(statAverage(snapshotB.totals, "tpm", gamesWithStatsB))],
    ["TO/G", fixedNumber(statAverage(snapshotA.totals, "to", gamesWithStatsA)), fixedNumber(statAverage(snapshotB.totals, "to", gamesWithStatsB))],
  ];

  const embed = new EmbedBuilder()
    .setTitle(commandTitle(league, "Player Compare"))
    .setColor(0x00ceb8)
    .setDescription([
      `**${playerName(playerAId, players)}** - ${playerBioLine(playerAId, players)} - ${rosterA ? teamLabel(rosterA, userMap) : "Free Agent"}`,
      `**${playerName(playerBId, players)}** - ${playerBioLine(playerBId, players)} - ${rosterB ? teamLabel(rosterB, userMap) : "Free Agent"}`,
    ].join("\n"))
    .addFields(
      {
        name: "Season Snapshot",
        value: codeTable(["METRIC", compactPlayerName(playerAId, players, 14), compactPlayerName(playerBId, players, 14)], rows, [10, 14, 14]),
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
  matchups: handleMatchups,
  player: handlePlayer,
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
    if (["player", "compare"].includes(interaction.commandName)) {
      await handlePlayerAutocomplete(interaction);
    } else if (["roster", "team"].includes(interaction.commandName)) {
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
