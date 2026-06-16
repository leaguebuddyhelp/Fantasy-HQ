# Sleeper Discord Bot

A Discord slash-command bot that pulls fantasy football data from Sleeper.

## Discord Setup

1. Create an app at <https://discord.com/developers/applications>.
2. Go to **Bot**, create a bot, and copy the token into `DISCORD_TOKEN`.
3. Go to **OAuth2 > General** and copy the client ID into `DISCORD_CLIENT_ID`.
4. Go to **OAuth2 > URL Generator** and select:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Embed Links`, `Read Message History`
5. Open the generated URL and add the bot to your Discord server.
6. Enable Discord Developer Mode, right-click your server, and copy the server ID into `GUILD_ID`.

## Local Setup

```bash
cp .env.example .env
npm install
npm run deploy:commands
npm start
```

## Environment

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
GUILD_ID=
SLEEPER_USERNAME=
SLEEPER_LEAGUE_ID=
SLEEPER_SEASON=2026
```

Sleeper's public API is read-only and does not require an API key.

`SLEEPER_LEAGUE_ID` is optional. The bot can connect a league from Discord and store it locally in `data/guilds.json`.

## Connect a League from Discord

1. Start the bot.
2. Run `/connect username:<sleeper username>`.
3. Copy the `league_id` from the league you want.
4. Run `/setleague league_id:<league id>`.
5. Run `/league` to confirm the server is connected.

The saved league is per Discord server. The local `SLEEPER_LEAGUE_ID` value is only used as a fallback.

## Commands

- `/connect username:<name> season:<year>` - Lists Sleeper leagues for a username.
- `/setleague league_id:<id>` - Connects this Discord server to a Sleeper league.
- `/useleague league_id:<id>` - Alias for `/setleague`.
- `/league` - Shows the connected Sleeper league.
- `/standings` - Shows league standings by wins and fantasy points.
- `/matchups week:<number>` - Shows weekly matchups. If week is omitted, the bot uses Sleeper's current NFL week.
- `/roster team:<name>` - Shows a manager's roster.
- `/transactions week:<number>` - Shows adds, drops, trades, and waiver/free-agent activity.
