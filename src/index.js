require("dotenv").config();

const { Client, EmbedBuilder, Events, GatewayIntentBits } = require("discord.js");
const { readConfig } = require("./config");
const sleeper = require("./sleeper");
const { getGuildConfig, setGuildLeague } = require("./store");
const {
  byRosterId,
  byUserId,
  chunkLines,
  findRosterByTeam,
  formatPoints,
  formatRecord,
  managerName,
  playerLabel,
  sortStandings,
} = require("./format");

const config = readConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function requireLeagueId(interaction) {
  const guildConfig = getGuildConfig(interaction.guildId);
  const leagueId = guildConfig?.leagueId || config.sleeperLeagueId;

  if (!leagueId) {
    throw new Error("No Sleeper league connected. Run /connect username:<sleeper username>, then /useleague league_id:<id>.");
  }

  return leagueId;
}

async function currentWeek(optionWeek) {
  if (optionWeek) return optionWeek;
  const state = await sleeper.getNflState();
  return state.week || 1;
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
      { name: "Teams", value: String(league.total_rosters || "Unknown"), inline: true },
      { name: "Status", value: league.status || "Unknown", inline: true },
      { name: "Source", value: source, inline: true },
    );

  await interaction.editReply({ embeds: [embed] });
}

async function handleConnect(interaction) {
  const username = interaction.options.getString("username", true);
  const season = interaction.options.getString("season") || config.sleeperSeason;
  const user = await sleeper.getUser(username);

  if (!user?.user_id) {
    throw new Error(`No Sleeper user found for "${username}".`);
  }

  const leagues = await sleeper.getUserLeagues(user.user_id, season);
  const lines = leagues.map((league) => {
    const teams = league.total_rosters ? `, ${league.total_rosters} teams` : "";
    return `**${league.name}** (${league.season}${teams})\nUse: \`/useleague league_id:${league.league_id}\``;
  });

  await interaction.editReply({
    content: lines.length
      ? `Leagues for ${user.display_name || username} in ${season}:\n\n${lines.join("\n\n")}`
      : `No leagues found for ${username} in ${season}.`,
  });
}

async function handleUseLeague(interaction) {
  const leagueId = interaction.options.getString("league_id", true);
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
  const week = await currentWeek(interaction.options.getInteger("week"));
  const { league, users, rosters } = await sleeper.getLeagueBundle(requireLeagueId(interaction));
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
    .setTitle(`${league.name} Matchups - Week ${week}`)
    .setColor(0x00ceb8)
    .setDescription(lines.join("\n") || "No matchups found.");

  await interaction.editReply({ embeds: [embed] });
}

async function handleRoster(interaction) {
  const query = interaction.options.getString("team", true);
  const { users, rosters } = await sleeper.getLeagueBundle(requireLeagueId(interaction));
  const roster = findRosterByTeam(query, users, rosters);

  if (!roster) {
    await interaction.editReply(`No roster matched "${query}". Try the manager name, Sleeper username, or team name.`);
    return;
  }

  const players = await sleeper.getPlayers();
  const userMap = byUserId(users);
  const user = userMap.get(roster.owner_id);
  const starters = new Set(roster.starters || []);
  const rosterPlayers = roster.players || [];
  const lines = rosterPlayers.map((playerId) => {
    const prefix = starters.has(playerId) ? "S" : "B";
    return `\`${prefix}\` ${playerLabel(playerId, players)}`;
  });

  const chunks = chunkLines(lines);
  const embed = new EmbedBuilder()
    .setTitle(`${managerName(user)} Roster`)
    .setColor(0x00ceb8)
    .setDescription(chunks[0] || "No players found.");

  await interaction.editReply({ embeds: [embed] });

  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({ content: chunk, ephemeral: false });
  }
}

function transactionLine(transaction, rosterMap, userMap, players) {
  const rosterNames = (transaction.roster_ids || [])
    .map((rosterId) => managerName(userMap.get(rosterMap.get(rosterId)?.owner_id)))
    .join(", ");
  const adds = Object.entries(transaction.adds || {})
    .map(([playerId, rosterId]) => `${playerLabel(playerId, players)} to ${managerName(userMap.get(rosterMap.get(rosterId)?.owner_id))}`);
  const drops = Object.entries(transaction.drops || {})
    .map(([playerId, rosterId]) => `${playerLabel(playerId, players)} from ${managerName(userMap.get(rosterMap.get(rosterId)?.owner_id))}`);
  const moves = [...adds.map((item) => `+ ${item}`), ...drops.map((item) => `- ${item}`)];
  const status = transaction.status ? ` (${transaction.status})` : "";

  return `**${transaction.type}${status}** - ${rosterNames || "League"}\n${moves.slice(0, 8).join("\n") || "No player movement listed."}`;
}

async function handleTransactions(interaction) {
  const week = await currentWeek(interaction.options.getInteger("week"));
  const { league, users, rosters } = await sleeper.getLeagueBundle(requireLeagueId(interaction));
  const [transactions, players] = await Promise.all([
    sleeper.getTransactions(league.league_id, week),
    sleeper.getPlayers(),
  ]);
  const rosterMap = byRosterId(rosters);
  const userMap = byUserId(users);
  const lines = transactions
    .slice(0, 10)
    .map((transaction) => transactionLine(transaction, rosterMap, userMap, players));

  const chunks = chunkLines(lines.length ? lines : ["No transactions found."]);
  const embed = new EmbedBuilder()
    .setTitle(`${league.name} Transactions - Week ${week}`)
    .setColor(0x00ceb8)
    .setDescription(chunks[0]);

  await interaction.editReply({ embeds: [embed] });
}

const handlers = {
  connect: handleConnect,
  league: handleLeague,
  matchups: handleMatchups,
  roster: handleRoster,
  setleague: handleUseLeague,
  standings: handleStandings,
  transactions: handleTransactions,
  useleague: handleUseLeague,
};

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
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
