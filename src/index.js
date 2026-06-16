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
  const { league, users, rosters } = await sleeper.getLeagueBundle(requireLeagueId(interaction));
  const userMap = byUserId(users);
  const lines = sortStandings(rosters).map((roster, index) => {
    const user = userMap.get(roster.owner_id);
    return `${index + 1}. **${managerName(user)}** - ${formatRecord(roster.settings)} - ${formatPoints(roster.settings)} pts`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} Standings`)
    .setColor(0x00ceb8)
    .setDescription(lines.join("\n") || "No rosters found.");

  await interaction.editReply({ embeds: [embed] });
}

async function handleMatchups(interaction) {
  const { league, users, rosters } = await sleeper.getLeagueBundle(requireLeagueId(interaction));
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
    .setTitle(`${league.name} Matchups - Period ${week}`)
    .setColor(0x00ceb8)
    .setDescription(lines.join("\n") || `No matchups found for period ${week}. League status: ${league.status || "unknown"}.`);

  await interaction.editReply({ embeds: [embed] });
}

async function handleRoster(interaction) {
  const query = interaction.options.getString("team", true);
  const { league, users, rosters } = await sleeper.getLeagueBundle(requireLeagueId(interaction));
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
  const { league, users, rosters } = await sleeper.getLeagueBundle(requireLeagueId(interaction));
  const week = await currentWeek(league, interaction.options.getInteger("week"));
  const [transactions, players] = await Promise.all([
    sleeper.getTransactions(league.league_id, week),
    sleeper.getPlayers(league.sport || "nfl"),
  ]);
  const rosterMap = byRosterId(rosters);
  const userMap = byUserId(users);
  const fields = transactions
    .slice(0, 10)
    .map((transaction) => transactionField(transaction, rosterMap, userMap, players));

  const embed = new EmbedBuilder()
    .setTitle(`${league.name} Transactions - Period ${week}`)
    .setColor(0x00ceb8);

  if (fields.length) {
    embed.addFields(fields);
  } else {
    embed.setDescription("No transactions found.");
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleRosterAutocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused().toLowerCase();
    const { users, rosters } = await sleeper.getLeagueBundle(requireLeagueId(interaction));
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
  connect: handleConnect,
  league: handleLeague,
  matchups: handleMatchups,
  roster: handleRoster,
  standings: handleStandings,
  transactions: handleTransactions,
};

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === "roster") {
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
