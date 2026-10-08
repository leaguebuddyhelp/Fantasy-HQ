require("dotenv").config();

const { PermissionFlagsBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const { requireEnv } = require("./src/config");

const commands = [
  new SlashCommandBuilder().setName("mockdraft").setDescription("View a private first-round projection for any draft class.")
    .addIntegerOption(option => option.setName("draft_class").setDescription("Choose a draft class; defaults to the current league class.").addChoices(...[1, 2, 3, 4].map(value => ({ name: `2K27 CUS${String(value).padStart(2, '0')}`, value })))),
  new SlashCommandBuilder().setName("week").setDescription("Manage regular-season week advancement.")
    .addSubcommand(sub => sub.setName("advance").setDescription("Review and confirm completion of the active week.").addBooleanOption(option => option.setName("force").setDescription("Request confirmation to close the week with unresolved games.")))
    .addSubcommand(sub => sub.setName("playoffs").setDescription("Review final standings and confirm playoff seeding after Week 15.")),
  new SlashCommandBuilder().setName("activitycheck").setDescription("Post a 24-hour activity check in the activity check channel."),
  new SlashCommandBuilder().setName("tradeblock").setDescription("Manage your team's trade block.")
    .addSubcommand(sub => sub.setName("add").setDescription("Add a player from your roster to your trade block.").addStringOption(option => option.setName("player").setDescription("Player on your roster.").setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName("remove").setDescription("Remove a player from your trade block.").addStringOption(option => option.setName("player").setDescription("Player on your trade block.").setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName("setup").setDescription("Staff: create the trade block thread for every team.")),
  new SlashCommandBuilder().setName("standings").setDescription("Regular-season standings from official game results.")
    .addStringOption(option => option.setName("conference").setDescription("Show one conference, or omit for both.").addChoices({ name: "East", value: "East" }, { name: "West", value: "West" })),
  new SlashCommandBuilder().setName("stats").setDescription("View a player's official regular-season statistics.")
    .addStringOption(option => option.setName("player").setDescription("Search a league player.").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName("teamstats").setDescription("View a team's official regular-season statistics.")
    .addStringOption(option => option.setName("team").setDescription("Search for a league team.").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName("upgrades").setDescription("View your player-upgrade balance, eligibility and history."),
  new SlashCommandBuilder().setName("games").setDescription("Manage active-week private game threads.")
    .addSubcommand(sub => sub.setName("create").setDescription("Confirm replacement of all ACTIVE-week game threads."))
    .addSubcommand(sub => sub.setName("cleanup").setDescription("Confirm deletion of all game threads for a selected week.").addIntegerOption(option => option.setName("week").setDescription("Regular-season week to clean, including unfinished games.").setRequired(true).setMinValue(1).setMaxValue(15))),
  new SlashCommandBuilder().setName("game").setDescription("Set up screenshot submission in an existing private game thread.")
    .addSubcommand(sub => sub.setName("setup").setDescription("Link this private thread to a scheduled game and post Submit Game.")
      .addIntegerOption(option => option.setName("week").setDescription("Scheduled week.").setRequired(true).setMinValue(1).setMaxValue(15))
      .addStringOption(option => option.setName("team").setDescription("One team's exact name or abbreviation.").setRequired(true))),
  new SlashCommandBuilder().setName("bigboard").setDescription("Browse this season's full Big Board, ten prospects per page."),
  new SlashCommandBuilder().setName("scout").setDescription("Spend 10 scouting points to unlock a prospect's next rating.")
    .addStringOption(option => option.setName("position").setDescription("Filter prospects by position.").setRequired(true).addChoices(...["PG", "SG", "SF", "PF", "C"].map(value => ({ name: value, value }))))
    .addStringOption(option => option.setName("prospect").setDescription("Search prospects at the selected position by name or team.").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder()
    .setName("toptenpreview")
    .setDescription("Browse the 2K27 top ten preview.")
    .addStringOption((option) =>
      option
        .setName("draft_class")
        .setDescription("Choose one of the available draft classes.")
        .setRequired(false)
        .setAutocomplete(true),
    ),
  new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Generate and view FantasyHQ MyNBA schedules.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("generate")
        .setDescription("Generate a new randomized conference schedule preview."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preview")
        .setDescription("Show the current unconfirmed schedule preview."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("regenerate")
        .setDescription("Regenerate the pending schedule preview."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("confirm")
        .setDescription("Confirm and save the pending schedule."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("mine")
        .setDescription("Show the full 15-week schedule for your assigned team."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("week")
        .setDescription("Show one week from the saved schedule.")
        .addIntegerOption((option) =>
          option
            .setName("week")
            .setDescription("Week number (1-15).")
            .setMinValue(1)
            .setMaxValue(15)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("team")
        .setDescription("Show one team's full 15-week schedule.")
        .addStringOption((option) =>
          option
            .setName("team")
            .setDescription("Team name or abbreviation.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("full")
        .setDescription("Download the full saved schedule."),
    ),
  new SlashCommandBuilder()
    .setName("ratings")
    .setDescription("Browse the local 2KRatings roster and free agency data.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("team")
        .setDescription("Show a team's latest 2KRatings roster.")
        .addStringOption((option) =>
          option
            .setName("team")
            .setDescription("Team name.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("player")
        .setDescription("Show one player's latest 2KRatings card.")
        .addStringOption((option) =>
          option
            .setName("player")
            .setDescription("Player name.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("top")
        .setDescription("Show the highest-rated current roster players.")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("How many players to show.")
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("position")
            .setDescription("Filter by position.")
            .addChoices(
              { name: "PG", value: "PG" },
              { name: "SG", value: "SG" },
              { name: "SF", value: "SF" },
              { name: "PF", value: "PF" },
              { name: "C", value: "C" },
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("freeagency")
        .setDescription("Show the highest-rated free agents.")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("How many free agents to show.")
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("position")
            .setDescription("Filter by position.")
            .addChoices(
              { name: "PG", value: "PG" },
              { name: "SG", value: "SG" },
              { name: "SF", value: "SF" },
              { name: "PF", value: "PF" },
              { name: "C", value: "C" },
            )
            .setRequired(false),
        ),
    ),
  new SlashCommandBuilder()
    .setName("player")
    .setDescription("Show one LEAGUEbuddy player profile.")
    .addStringOption((option) =>
      option
        .setName("player")
        .setDescription("Player name.")
        .setRequired(true)
        .setAutocomplete(true),
    ),
  new SlashCommandBuilder().setName("myteam").setDescription("Your roster, owner, and upcoming schedule."),
  new SlashCommandBuilder().setName("freeagents").setDescription("Browse available players in your league.")
    .addIntegerOption((option) => option.setName("page").setDescription("Page to view.").setMinValue(1))
    .addStringOption((option) => option.setName("position").setDescription("Filter by position.")
      .addChoices(...["PG", "SG", "SF", "PF", "C"].map((value) => ({ name: value, value })))),
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Configure FantasyHQ league data for this Discord server.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("bind")
        .setDescription("Bind this Discord server to an existing FantasyHQ league.")
        .addStringOption((option) =>
          option
            .setName("league_id")
            .setDescription("League identifier.")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("season_id")
            .setDescription("Season identifier.")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("season")
        .setDescription("Set the active season for this server's bound league.")
        .addStringOption((option) =>
          option
            .setName("season_id")
            .setDescription("Season identifier.")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show the current FantasyHQ league binding and schedule status."),
    ),
  new SlashCommandBuilder()
    .setName("league")
    .setDescription("Create and configure a LEAGUEbuddy setup league.")
    .addSubcommand((subcommand) => subcommand.setName("delete").setDescription("Permanently delete this server’s league after confirmation."))
    .addSubcommand((subcommand) => subcommand.setName("roles").setDescription("Create or repair the 30 team roles and five LEAGUEbuddy roles."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a new league in SETUP phase and bind it to this server.")
        .addStringOption((option) =>
          option.setName("league_id").setDescription("Unique short label, e.g. 2k-test-03. Letters, numbers, hyphens, underscores.").setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("league_name").setDescription("League display name.").setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName("season_number").setDescription("Season number; defaults to 1.").setRequired(false).setMinValue(1),
        )
        .addBooleanOption((option) => option.setName("test_mode").setDescription("Enable staff-only solo test controls and allow vacant teams.")),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show current setup status and league progress."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("setup")
        .setDescription("Show the setup dashboard."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("settings")
        .setDescription("Update league-level setup settings.")
        .addBooleanOption(option => option.setName("test_mode").setDescription("Explicitly enable or disable solo Test Mode while in SETUP."))
        .addBooleanOption((option) =>
          option.setName("require_all_owners").setDescription("Require all 30 teams to have owners before activation.").setRequired(false),
        )
        .addIntegerOption((option) =>
          option.setName("playoff_teams").setDescription("Playoff teams per conference (8).").setRequired(false).setMinValue(8).setMaxValue(8),
        )
        .addIntegerOption((option) =>
          option.setName("game_deadline_hours").setDescription("Regular-season game deadline (48 hours).").setRequired(false).setMinValue(48).setMaxValue(48),
        )
,
    ),
  new SlashCommandBuilder()
    .setName("roster")
    .setDescription("Import and inspect setup roster data.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("import")
        .setDescription("Import the latest roster snapshots into the active league."),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("freeagency").setDescription("Add missing free agents without replacing league rosters."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show roster import status for the active league."),
    ),
  new SlashCommandBuilder()
    .setName("team")
    .setDescription("Manage teams during the setup phase.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List all teams and their owner assignments."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("roster")
        .setDescription("Show one imported team roster.")
        .addStringOption((option) =>
          option.setName("team").setDescription("Team to view.").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("assign")
        .setDescription("Assign a Discord user to a team.")
        .addStringOption((option) =>
          option.setName("team").setDescription("Team to assign.").setRequired(true).setAutocomplete(true),
        )
        .addUserOption((option) =>
          option.setName("user").setDescription("User to assign.").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unassign")
        .setDescription("Remove the current owner assignment from a team.")
        .addStringOption((option) =>
          option.setName("team").setDescription("Team to unassign.").setRequired(true).setAutocomplete(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Validate and activate the current league setup.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("activate")
        .setDescription("Activate the league and move it to PRESEASON."),
    ),
].map((command) => command.toJSON()).filter((command) => command.name !== "setup").map((command) => {
  const retired = {
    schedule: ["confirm", "regenerate"],
    league: ["status"],
    admin: ["status", "season"],
    roster: ["status"],
    ratings: ["freeagency"],
  };
  if (retired[command.name]) command.options = command.options.filter((option) => !retired[command.name].includes(option.name));
  return command;
});

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
