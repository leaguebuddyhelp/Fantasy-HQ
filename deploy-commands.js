require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const { requireEnv } = require("./src/config");

function seasonOption(option) {
  return option
    .setName("season")
    .setDescription("Season year, like 2025. Defaults to the connected league season.")
    .setRequired(false);
}

function periodOption(option) {
  return option
    .setName("week")
    .setDescription("Scoring period. Defaults to the sport's current period.")
    .setMinValue(1)
    .setMaxValue(30)
    .setRequired(false);
}

function teamOption(name, description, required = true) {
  return (option) =>
    option
      .setName(name)
      .setDescription(description)
      .setRequired(required)
      .setAutocomplete(true);
}

function playerOption(option) {
  return option
    .setName("player")
    .setDescription("Choose a rostered player from the connected league.")
    .setRequired(true)
    .setAutocomplete(true);
}

const commands = [
  new SlashCommandBuilder()
    .setName("connect")
    .setDescription("Connect this Discord server to Sleeper by league ID, or find leagues by username.")
    .addStringOption((option) =>
      option
        .setName("league_id")
        .setDescription("Sleeper league ID. Use this to connect immediately.")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("Sleeper username. Use this to find league IDs.")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("season")
        .setDescription("Sleeper season for username lookup. Defaults to SLEEPER_SEASON or 2026.")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("sport")
        .setDescription("Sport for username lookup. Defaults to NBA and NFL.")
        .setRequired(false)
        .addChoices(
          { name: "NBA", value: "nba" },
          { name: "NFL", value: "nfl" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("league")
    .setDescription("Show the Sleeper league connected to this Discord server."),
  new SlashCommandBuilder()
    .setName("standings")
    .setDescription("Show Sleeper league standings.")
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("matchups")
    .setDescription("Show Sleeper matchups for a scoring period.")
    .addIntegerOption(periodOption)
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("roster")
    .setDescription("Show a manager's Sleeper roster.")
    .addStringOption(teamOption("team", "Choose a team from the connected league."))
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("transactions")
    .setDescription("Show Sleeper league transactions for a scoring period.")
    .addIntegerOption(periodOption)
    .addStringOption(seasonOption)
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Filter transaction type.")
        .setRequired(false)
        .addChoices(
          { name: "Free Agent", value: "free_agent" },
          { name: "Waiver", value: "waiver" },
          { name: "Trade", value: "trade" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show a season overview for this league.")
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("leaders")
    .setDescription("Show season player leaders.")
    .addStringOption((option) =>
      option
        .setName("stat")
        .setDescription("Leaderboard stat.")
        .setRequired(true)
        .addChoices(
          { name: "Fantasy", value: "fantasy" },
          { name: "Points", value: "pts" },
          { name: "Rebounds", value: "reb" },
          { name: "Assists", value: "ast" },
          { name: "Steals", value: "stl" },
          { name: "Blocks", value: "blk" },
          { name: "Threes", value: "tpm" },
          { name: "Turnovers", value: "to" },
        ),
    )
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("playoffs")
    .setDescription("Show playoff bracket results.")
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("team")
    .setDescription("Show a historical team dashboard.")
    .addStringOption(teamOption("team", "Choose a team from the selected season."))
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("recap")
    .setDescription("Show a weekly recap with high score, close matchups, and top players.")
    .addIntegerOption(periodOption)
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("draft")
    .setDescription("Show draft recap and pick results.")
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("player")
    .setDescription("Show player season stats, weekly game log, projections, and cache the data.")
    .addStringOption(playerOption)
    .addIntegerOption(periodOption)
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("compare")
    .setDescription("Compare two teams in the selected season.")
    .addStringOption(teamOption("team_a", "First team."))
    .addStringOption(teamOption("team_b", "Second team."))
    .addStringOption(seasonOption),
].map((command) => command.toJSON());

async function main() {
  const token = requireEnv("DISCORD_TOKEN");
  const clientId = requireEnv("DISCORD_CLIENT_ID");
  const guildId = requireEnv("GUILD_ID");

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

  console.log(`Registered ${commands.length} slash commands for guild ${guildId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
