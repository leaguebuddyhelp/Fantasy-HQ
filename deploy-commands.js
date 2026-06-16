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
    ),
  new SlashCommandBuilder()
    .setName("league")
    .setDescription("Show the Sleeper league connected to this Discord server."),
  new SlashCommandBuilder()
    .setName("standings")
    .setDescription("Show Sleeper league standings."),
  new SlashCommandBuilder()
    .setName("matchups")
    .setDescription("Show Sleeper matchups for a week.")
    .addIntegerOption((option) =>
      option
        .setName("week")
        .setDescription("NFL week number. Defaults to Sleeper's current NFL week.")
        .setMinValue(1)
        .setMaxValue(22),
    ),
  new SlashCommandBuilder()
    .setName("roster")
    .setDescription("Show a manager's Sleeper roster.")
    .addStringOption((option) =>
      option
        .setName("team")
        .setDescription("Manager display name or Sleeper username.")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("transactions")
    .setDescription("Show Sleeper league transactions for a week.")
    .addIntegerOption((option) =>
      option
        .setName("week")
        .setDescription("NFL week number. Defaults to Sleeper's current NFL week.")
        .setMinValue(1)
        .setMaxValue(22),
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
