require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const { requireEnv } = require("./src/config");

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
    .setDescription("Show Sleeper league standings."),
  new SlashCommandBuilder()
    .setName("matchups")
    .setDescription("Show Sleeper matchups for a scoring period.")
    .addIntegerOption((option) =>
      option
        .setName("week")
        .setDescription("Scoring period. Defaults to the sport's current period.")
        .setMinValue(1)
        .setMaxValue(30),
    ),
  new SlashCommandBuilder()
    .setName("roster")
    .setDescription("Show a manager's Sleeper roster, or list teams if no team is supplied.")
    .addStringOption((option) =>
      option
        .setName("team")
        .setDescription("Manager display name or Sleeper username.")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("transactions")
    .setDescription("Show Sleeper league transactions for a scoring period.")
    .addIntegerOption((option) =>
      option
        .setName("week")
        .setDescription("Scoring period. Defaults to the sport's current period.")
        .setMinValue(1)
        .setMaxValue(30),
    ),
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
