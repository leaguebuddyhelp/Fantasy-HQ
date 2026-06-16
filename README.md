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

If you do not know your league ID yet, fill in `SLEEPER_USERNAME` and run `/league` after starting the bot. It will show leagues for the configured season when `SLEEPER_LEAGUE_ID` is empty.

## Commands

- `/league` - Shows the configured league, or leagues for `SLEEPER_USERNAME` when no league ID is set.
- `/standings` - Shows league standings by wins and fantasy points.
- `/matchups week:<number>` - Shows weekly matchups. If week is omitted, the bot uses Sleeper's current NFL week.
- `/roster team:<name>` - Shows a manager's roster.
- `/transactions week:<number>` - Shows adds, drops, trades, and waiver/free-agent activity.

