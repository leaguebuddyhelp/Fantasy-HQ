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

function playerOption(name = "player", description = "Choose a rostered player from the connected league.", required = true) {
  return (option) =>
    option
      .setName(name)
      .setDescription(description)
      .setRequired(required)
      .setAutocomplete(true);
}

function pickOption(name, description) {
  return (option) =>
    option
      .setName(name)
      .setDescription(description)
      .setRequired(false)
      .addChoices(
        { name: "No pick", value: "none" },
        { name: "1st", value: "first" },
        { name: "2nd", value: "second" },
        { name: "3rd", value: "third" },
        { name: "1st + 2nd", value: "first_second" },
      );
}

function needOption(option) {
  return option
    .setName("need")
    .setDescription("What the team wants to improve.")
    .setRequired(false)
    .addChoices(
      { name: "Whatever Helps Most", value: "fit" },
      { name: "Points", value: "pts" },
      { name: "Rebounds", value: "reb" },
      { name: "Assists", value: "ast" },
      { name: "Steals", value: "stl" },
      { name: "Blocks", value: "blk" },
      { name: "Threes", value: "tpm" },
      { name: "Younger Players", value: "youth" },
      { name: "Help Now", value: "win_now" },
    );
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
    .setDescription("Show standings with a simple team strength note.")
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
    .setName("team")
    .setDescription("Show a team summary and what they need.")
    .addStringOption(teamOption("team", "Choose a team from the selected season."))
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("player")
    .setDescription("Show a player summary, stats, and trend.")
    .addStringOption(playerOption())
    .addIntegerOption(periodOption)
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("compare")
    .setDescription("Compare two players in the selected season.")
    .addStringOption(playerOption("player_a", "First player."))
    .addStringOption(playerOption("player_b", "Second player."))
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("market")
    .setDescription("Show players to ask about, hot players, steady players, and avoids.")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Which player list to show.")
        .setRequired(false)
        .addChoices(
          { name: "All", value: "all" },
          { name: "Worth Asking About", value: "buy_low" },
          { name: "Hot Right Now", value: "sell_high" },
          { name: "Hold", value: "hold" },
          { name: "Avoid", value: "fade" },
        ),
    )
    .addStringOption(teamOption("team", "Optional team filter.", false))
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Quickly check who wins a trade.")
    .addStringOption(playerOption("a1", "Side A player 1."))
    .addStringOption(playerOption("b1", "Side B player 1."))
    .addStringOption(playerOption("a2", "Side A player 2.", false))
    .addStringOption(playerOption("a3", "Side A player 3.", false))
    .addStringOption(playerOption("b2", "Side B player 2.", false))
    .addStringOption(playerOption("b3", "Side B player 3.", false))
    .addStringOption(pickOption("a_pick", "Pick added to Side A."))
    .addStringOption(pickOption("b_pick", "Pick added to Side B."))
    .addStringOption(seasonOption),
  new SlashCommandBuilder()
    .setName("tradefinder")
    .setDescription("Find simple trade ideas for a team.")
    .addStringOption(teamOption("team", "Team to build trade ideas for."))
    .addStringOption(needOption)
    .addStringOption((option) =>
      option
        .setName("offer_style")
        .setDescription("How much you are willing to offer.")
        .setRequired(false)
        .addChoices(
          { name: "Fair", value: "fair" },
          { name: "Try Cheap", value: "value" },
          { name: "Overpay", value: "overpay" },
        ),
    )
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
