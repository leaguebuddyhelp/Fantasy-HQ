require("dotenv").config();

const { Client, EmbedBuilder, Events, GatewayIntentBits } = require("discord.js");
const { readConfig } = require("./config");
const sleeper = require("./sleeper");
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

function requireLeagueId() {
  if (!config.sleeperLeagueId) {
    throw new Error("Set SLEEPER_LEAGUE_ID in .env, or use /league with SLEEPER_USERNAME to find it.");
  }
  return config.sleeperLeagueId;
}

async function currentWeek(optionWeek) {
  if (optionWeek) return optionWeek;
  const state = await sleeper.getNflState();
  return state.week || 1;
}

async function handleLeague(interaction) {
  if (config.sleeperLeagueId) {
    const league = await sleeper.getLeague(config.sleeperLeagueId);
    const embed = new EmbedBuilder()
      .setTitle(league.name || "Sleeper League")
      .setColor(0x00ceb8)
      .addFields(
        { name: "League ID", value: league.league_id, inline: true },
        { name: "Season", value: String(league.season), inline: true },
        { name: "Teams", value: String(league.total_rosters || "Unknown"), inline: true },
        { name: "Status", value: league.status || "Unknown", inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (!config.sleeperUsername) {
    throw new Error("Set SLEEPER_USERNAME or SLEEPER_LEAGUE_ID in .env.");
  }

  const user = await sleeper.getUser(config.sleeperUsername);
  const leagues = await sleeper.getUserLeagues(user.user_id, config.sleeperSeason);
  const lines = leagues.map((league) => `**${league.name}**\nID: \`${league.league_id}\``);

  await interaction.editReply({
    content: lines.length
      ? `Leagues for ${user.display_name || config.sleeperUsername} in ${config.sleeperSeason}:\n\n${lines.join("\n\n")}`
      : `No leagues found for ${config.sleeperUsername} in ${config.sleeperSeason}.`,
  });
}

async function handleStandings(interaction) {
  const { league, users, rosters } = await sleeper.getLeagueBundle(requireLeagueId());
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
  const { league, users, rosters } = await sleeper.getLeagueBundle(requireLeagueId());
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
  const { users, rosters } = await sleeper.getLeagueBundle(requireLeagueId());
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
  const { league, users, rosters } = await sleeper.getLeagueBundle(requireLeagueId());
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
