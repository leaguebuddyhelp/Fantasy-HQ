# Leaguebuddy Draft Bot

A Discord app and companion website for league setup, roster and season operations, stats, scouting, and live first-round mock drafts.

## Local Setup

```bash
cp .env.example .env
npm install
npm run deploy:commands
npm start
```

The same app also serves the website on `PORT` (default `3000`). To run only the website during design work, use `npm run start:web`.

## Environment

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
GUILD_ID=
PORT=3000
WEBSITE_URL=http://localhost:3000
WEBSITE_ADMIN_KEY=
```

Set `WEBSITE_URL` to the public base URL of the deployed app so the Discord **Full Profile** button opens the correct prospect. Railway deployments automatically use `RAILWAY_PUBLIC_DOMAIN` when `WEBSITE_URL` is omitted.

## League website setup and preseason

Both `npm start` and `npm run start:web` load `.env`. The website uses `GUILD_ID` to select the league bound to that Discord server. The bot and website must share the same league data directory. On a deployed host, configure the environment variables there and provide persistent storage for `data/`; local files are not uploaded automatically.

The player directory reads imported league players, not the raw ratings snapshots or custom draft classes. An empty directory can therefore mean the league has not imported its rosters yet.

Complete the initial setup in Discord with Manage Server permission:

1. Run `/league create` with your league ID, name, and season number. This creates settings and binds the server. Existing league IDs and servers already connected to a league are rejected; existing leagues cannot be reset by this command.
2. Creation automatically imports NBA team rosters and free agents. Use `/roster import` only to recover a failed import, before making custom roster edits.
3. Assign coaches with `/team assign`. Start with 1–30 coaches; unassigned teams are CPU teams in both online and test leagues.
4. Run `/schedule generate`, review the preview, then the **Confirm schedule** button.
5. Run `/league setup`, resolve any errors, then the **Enter preseason** checklist button to enter `PRESEASON`.

For the website commissioner tools, set a private `WEBSITE_ADMIN_KEY` in the server environment, restart the app, and enter that same key in **Admin access**. A blank server key disables admin access.

During preseason:

- **Roster manager** loads a team's imported roster for editing, adding, moving, or removing players.
- **Roster import preview** compares a selected team's league roster with the latest local ratings snapshot. Review the changes before choosing **Apply import**. This is for refreshing an existing roster; use `/roster import` for initial league setup.
- **Data issues** identifies roster and player problems; **Audit log** records administrative changes.
- **Validate preseason** checks readiness. **Start season** changes `PRESEASON` to `REGULAR_SEASON` and activates week one. It is a real state change, not a preview.

The regular season supports game submissions, official standings, and confirmed advancement through Week 15. Playoffs and the postseason workflow are not implemented.

## Player Upgrades

Run `/league setup` → **Create / repair channels** to create the read-only `lb-player-upgrades` ledger and its single pinned **REQUEST UPGRADE** entry. Coaches use `/upgrades` for private balances, player eligibility, and their current-season history. Only configured Commish or Assistant Commish roles can approve or reject ledger requests.

One game-earned upgrade is awarded after each four qualifying games under the current coach tenure. Only finalized two-coach `TEAM_SIDES` box scores with at least one non-DNP player for the team count; staff-submitted games and decisions/sims do not. Normal upgrades record the coach's 1–5 point allocation without storing individual 2K ratings. Each player can complete two upgrades per season; each team can complete one Special after its current coach reaches four qualifying games.

Upgrade state is stored beside the existing league JSON in `player-upgrades.json`; player OVR, archetype, and Strength Training weight changes update the existing permanent player record. Trade Value continues to be calculated by the existing valuation service. Run `npm run deploy:commands` and restart the bot to enable `/upgrades` and its interaction handlers.

## Regular-Season Trades

Run `/league setup` and choose **Create / repair channels**. Setup creates or updates one pinned **Build a Trade** message in Submit Trade and one pinned Trade Counts embed; their message IDs are stored under `settings.discordPins`. Channel IDs continue to use `settings.discordChannels`. Coaches use the pinned button; there is no trade slash command or separate test mode. The existing league Test Mode enables commissioner simulation.

The persisted workflow covers coach approval/counter, eligible Trade Committee voting, one screenshot in a trade-specific proof thread, staff review, and an atomic roster/pick commit. New proposals close after Week 9. Values are calculated from league-season age and player profile, then frozen per submitted version. Player age and Trade Value appear in existing player and team views.

New league data is stored in `draft-picks.json` and `trades.json`; approved proof images live under `data/fantasyhq/trade-proof/`. Setup adds or reuses the `LEAGUEbuddy GM` role and configures the existing Submit Trade, Trade Committee, Trade Proof, Denied Trades, Approved Trades, and Trade Counts channels.

## Discord Commands

- `/myteam` — Your roster and upcoming games.
- `/player` — League player profile, current ratings, and photo.
- `/stats player:<player>` — Official regular-season averages and latest game; players without official games get a clean no-stats response.
- `/teamstats team:<team>` — Compact official regular-season team record, averages, and shooting percentages.
- `/freeagents` — Available league players, with position and page filters.
- `/team list` and `/team roster` — Team directory and rosters.
- Pinned **Build a Trade** in Submit Trade — Player/pick builder, package review, and proposal submission.
- `/team assign` and `/team unassign` — Staff controls for role-based ownership.
- `/mockdraft` — Run a private first-round mock with a configurable lottery and coach-controlled picks.
- `/toptenpreview` — Browse custom draft prospects with portraits and website profiles.
- `/bigboard` — Browse the complete season Big Board in private, ten prospects per page with portrait cards and your personal scouting unlocks.
- `/scout position:<PG|SG|SF|PF|C> prospect:<name>` — Choose a position, then search matching prospects. Spend 10 of your 60 weekly points to reveal the next rating: Draft Grade, OVR, then Potential. Points are personal, reset each league week, and do not roll over.
- `/schedule generate` — Create a paged preview; use its Confirm, Regenerate, or Cancel buttons.
- `/schedule preview` — Reopen an existing pending preview.
- `/schedule week`, `/schedule team`, `/schedule mine`, `/schedule full` — Saved schedules and download.
- `/league create`, `/league setup`, `/league settings`, `/league roles`, `/league delete` — League setup and management. Enter preseason from the setup checklist button.
- `/roster import` — Recover/reload the initial roster import during setup; replaces league player data.
- `/roster freeagency` — Add missing free agents without replacing edited rosters.
- `/ratings player`, `/ratings team`, `/ratings top` — Original source ratings, separate from edited league data.
- `/admin bind` — Reconnect an existing league to this server.

See [COMMAND-AUDIT.md](COMMAND-AUDIT.md) for retired commands and their replacements.

## LEAGUEbuddy Schedules

The schedule generator reads existing LEAGUEbuddy league/team records from `data/fantasyhq/` instead of scraping or inventing teams.

- Map each Discord guild to a league in [data/fantasyhq/README.md](/Users/brandongordon/Sleeper-Discord/data/fantasyhq/README.md).
- Store imported team records in `data/fantasyhq/leagues/<leagueId>/teams.json`.
- Saved schedules live in `data/fantasyhq/leagues/<leagueId>/schedules/<seasonId>.json`.

The scheduler enforces:

- 30 teams total
- 15 East and 15 West
- 15 weeks
- East-only and West-only regular season games
- 14 games and 1 bye per team
- Exactly one conference bye per week
- No duplicate matchups or duplicate weekly appearances

## Draft Website

The website and Discord bot share the JSON files and portraits under `draft_class/`.

- Files ending in `Early Top Ten.json` power the Discord preview and the website's early board.
- Files ending in `Big Board.json` power the website's 75-player big board.
- Recruiting and transfer portal JSON files remain available through the Discord commands.
- Portraits live under `draft_class/images/`.

The website provides:

- Early Top Ten and Big Board browsing
- Search and position filters
- Full scouting profile modals
- Stats Center sorting and filtering

The league **Stats** and **Team Stats** pages are separate from Player Profiles. Player Stats supports player search, team/conference filters and sortable averages, with chronological game logs. Team Stats lists all 30 teams with sortable records, averages and shooting percentages. Historical game logs retain the team represented in each game.

The league **Stats** page is separate from Player Profiles. It lists official regular-season player averages, supports player search, team/conference filters and sortable stats, and expands to chronological game logs. Team names in the main table use current rosters; logs retain each game's historical team and DNP status.

Big Board JSON files can be normalized after an update with:

```bash
npm run normalize:bigboard -- "draft_class/<file> - Big Board.json"
```

Bundled portraits use a three-digit board-rank prefix, such as `015-jake-jones.png`. Assign a folder of ranked portraits with:

```bash
npm run images:bigboard -- "draft_class/<file> - Big Board.json" "draft_class/images/<class>/<position>"
```

Generate `.webp` versions for draft portraits with:

```bash
npm run images:optimize
```

## Simplified league commands

Use `/league setup` for the checklist and next action, `/myteam` for your assigned roster and upcoming games, and `/freeagents` to browse available league players by position and page. `/team list` is the team directory. Retired command registrations: `/teams`, `/admin bootstrap`, `/setup validate`, `/recruiting`, `/transferportal`. Existing handlers remain compatible with old interactions until commands are registered again. No `/preseason status` command is added.

## Discord league roles

`/league create` automatically creates all 30 NBA team roles plus `LEAGUEbuddy Coach`, `LEAGUEbuddy Commish`, and `LEAGUEbuddy Assistant Commish`. Give the bot **Manage Roles** permission. For existing leagues or to retry interrupted creation, use `/league roles`; matching existing roles are reused. These are role labels with no extra server permissions and are not automatically assigned to members. League commands accept LEAGUEbuddy Commish, LEAGUEbuddy Assistant Commish, or Manage Server. Coach and team roles do not grant league-management access. Assign staff roles to trusted members in Discord; no Administrator or Manage Server permission is added to those roles.

Team logos are bundled under `web/assets/nba/` and used in Discord player profiles, team rosters, personal-team summaries, team schedules, and website team/player/schedule views. `/league roles` applies team icons when the server supports `ROLE_ICONS`; keep the bot role above team roles so existing icons can be updated. It does not change existing roles' Discord permissions. Re-register commands after updating so commissioner roles can access `/admin`.

## Role-based team ownership

Discord team roles are now the source of truth for owners. Give a member one NBA team role to make them that team's owner; remove it or remove the member from the server to vacate the team. The bot adds LEAGUEbuddy Coach to team-role holders and removes it when they hold no team role. Commish roles are independent and are never removed by this sync.

Enable **Server Members Intent** in the Discord Developer Portal under your application's **Bot → Privileged Gateway Intents** before starting this version. The bot also needs **Manage Roles**, with its role above the team and Coach roles. Register updated commands with `npm run deploy:commands`, restart, and let startup automatically reconcile the existing server. This initial sync replaces old manual owner records with actual team-role holders.

Ownership sync runs at startup, after member/role events, periodically, and after ownership commands. `/team assign` and `/team unassign` now change Discord roles and then save the resulting ownership, in any league phase. Assigning someone who already has another team is rejected; unassign that team first. Reassigning a team removes its previous holder's team role.

Multiple human members holding one team role, duplicate team roles, or one person holding multiple team roles are reported as conflicts rather than choosing an arbitrary owner. These conflicts block league activation. Bots do not count as owners. Failed member fetches preserve existing ownership. Role IDs are remembered after the first sync, so renaming a mapped team role does not lose its owner.

Website team details, owner counts, Discord team lists, `/myteam`, `/schedule mine`, and setup/preseason validators read the synced records. The website refreshes owner names/counts every 10 seconds while visible and when the window regains focus. Website-only mode shows the last saved sync; run the Discord bot for live membership updates.

Owner labels use Discord server display names, falling back to global names/usernames. Nickname and username changes trigger automatic sync too. `/league sync` has been removed: membership changes sync after a one-second debounce, plus startup/reconnect and a five-minute fallback.

## Delete a league

Use `/league delete` to delete the league currently bound to this server. A private prompt identifies the league and requires the same staff member to click **Delete league permanently** within two minutes. Cancel leaves it unchanged. Commish, Assistant Commish, or Manage Server access is required. All seasons, league records and matching game archives are removed, including original screenshots, box scores, submission history and saved game stats. Other leagues and shared source ratings, draft classes and logos are retained. Discord channels, threads, roles and their member assignments are retained. Shared leagues bound to another server cannot be deleted until that other binding is removed. After deletion, run `/league create` with a fresh ID, then `/roster import`. Existing team role holders become owners again; remove those assignments in Discord if you want vacant teams.

## Quick first-time setup

Run `/league create league_id:2k-test-03 league_name:My Test League`. Season defaults to 1. Creation prepares roles, imports teams and free agents, syncs existing team-role owners, and shows an Open setup checklist button. For single-user practice, use the Staff Test Mode panel to create an isolated simulation. A legacy league Test Mode flag does not authorize simulated trades or solo game submissions in canonical storage. Assign yourself a team with `/team assign`, generate and confirm a schedule, then use `/league setup` to enter preseason. Existing Discord role assignments survive deletion and carry into the new league. Website editing uses the host-configured website admin key, separately from Discord staff roles.

## Mock drafts

`/mockdraft` sends a private, 30-pick projection in one embed with team emojis and six compact pick groups. Every coach receives the same saved weekly board, including AVP and pick ownership. It survives restarts and refreshes after league week advancement; intraweek trades and simulation refreshes do not change the published command output. Live mocks retain realistic variation. The permanent **START LIVE MOCK** message in the existing Scouting Hub creates a private, temporary thread. Configured team coaches control their actual teams and all first-round picks those teams own. Invites close when the host locks order. The host runs/reruns the lottery, locks ownership, starts, and can pause/resume. Human picks have a persisted two-minute deadline, Top 10 Best Available, full-pool search, a prospect preview and final confirmation. CPU teams select immediately using the same market/value/need engine.

Run the existing channel repair from `/league setup` to create/reuse and pin the entry message and repair bot permissions. Deploy commands with `npm run deploy:commands`, then restart the bot to load the new interaction handlers and recovery worker. To initialize or manually repair a saved snapshot, run `npm run mock:refresh -- --league <league-id>` (or omit `--league` to use the configured guild binding). This only writes mock data. A 1,000-simulation snapshot has already been generated for the existing `2k-test` league.

Successful week transactions and completed, proof-approved current first-round pick trades queue durable refresh requests. The bot checks these in the background every 30 seconds. Starting a mock never generates the simulation dataset. Validated snapshots are stored under `data/fantasyhq/leagues/<league-id>/mock-draft/snapshots/`, with an atomic `active.json` pointer, `refresh.json` requests, `weekly-projection.json` for the published command board, and `live.json` execution/recap/delivery state. Snapshots referenced by running mocks remain available. Mocks never mutate real players, roster memberships, picks, scouting points or trades, and no mock history website is added.

Lottery rules select by draft year. 2019–2026 draws the top four of a 14-team lottery. 2027–2029 draws all 16 slots using 3-2-1 weights, bottom-three pick floors and original-team repeat restrictions. Picks outside the lottery retain inverse regular-season record order. Record ties use a stable season-specific hash to represent the NBA's tie drawing. The league currently has no real play-in results or prior real draft history service, so conference seeds project eligibility and missing history is disclosed. If actual data is available, use the existing settings file:

```json
{
  "mockDraft": {
    "playInLoserTeamIds": ["east-7-or-8-team-id", "west-7-or-8-team-id"],
    "priorOriginalPicks": {
      "2026": { "original-team-id": 1 },
      "2025": { "original-team-id": 4 }
    }
  }
}
```

Replace placeholders with existing league team IDs and record every known original first-round slot for each prior real draft. Never populate history from mock results. For legacy seasons, optional `mockDraft.playoffTeamIds` supplies the actual sixteen playoff teams. 2030+ provisionally continues 3-2-1 as requested; NBA has not announced those seasons' rules. Prospects not selected in any of the 1,000 first rounds have an explicit “Unselected” market result and null AVP, because their average selection is undefined.

After pick 30, the bot persists the complete recap and supported awards, attempts recap DMs to every invited participant, records closed-DM failures independently, and deletes the private thread. Failed cleanup retries with backoff. Restart recovery restores active/paused deadlines, unsent reactions, recap pages and pending cleanup. Run one Discord bot process per guild; persisted selection locks also protect backend commits across processes, while Discord message/thread operations are serialized within the bot process.

See [MOCK-DRAFT-TESTING.md](MOCK-DRAFT-TESTING.md) for the exact live test checklist and remaining data assumptions.

Player Trade Value adds an OVR tier premium to the nonlinear base: 85–89 OVR ×1.25, 90–94 ×1.60, and 95–99 ×2.10. These are exclusive tiers, combined with a separate prime-age premium: ages 24–29 ×1.25, ages 23/30 ×1.18, ages 22/31 ×1.10, and age 32 ×1.05. Existing age/development, positional size, wingspan, versatility, and experience factors remain part of the calculation. League age follows the league season rather than the real-world clock. The formula applies to all players without name-based overrides; submitted trade versions retain their frozen valuations.

## Team payroll imports

Team scans automatically fetch Basketball Reference payrolls and attach an unambiguous player contract match to each ratings record. Salary amounts are USD, keyed by the source's actual NBA season labels; player/team options and the published guaranteed total are retained separately. Missing salaries remain unknown rather than zero.

```bash
npm run scrape -- --team atlanta-hawks
```

The regular all-team scan (`npm run scrape`) and resumed scans also fetch payrolls. Team roster JSON includes the source payroll snapshot and unmatched roster names. Successful payroll snapshots are cached in `data/2kratings/contracts/<TEAM>.json`. If the source fails, the scan retains its last successful payroll, marks it `STALE`, and records the reason in `data/2kratings/logs/failures.json`; ratings collection continues. Without a prior successful payroll, salaries remain unavailable. Names match after accent/punctuation normalization; ambiguous or absent names are never guessed.

New league roster imports retain player contracts. Existing roster import previews include contract changes, and an unavailable payroll never clears a saved league contract. Source NBA season labels are not shifted to match a custom league season. This adds contract data to scans/imports; it does not introduce salary-cap trade rules or change trade values.


Regular-season repair workflows, playoff handoff, final-result corrections, individual Staff keys and backup/restore commands are documented in [READINESS-REPAIRS.md](READINESS-REPAIRS.md). Run `npm run check` before deployment and use a separate Discord test server for real multi-coach verification.

The Sportsbook is entirely in Discord. Open **MyTeam → SPORTSBOOK** for markets, private wallet, bets and parlays. Staff uses the **Sportsbook Staff Review** pin. See [Sportsbook in Discord](SPORTSBOOK-DISCORD.md). Website betting endpoints are retired.

Individual website credentials use `WEBSITE_ADMIN_KEYS` as a JSON mapping of Discord user IDs to private keys. Commissioner operations require a key mapped to the configured commissioner Discord ID. Named Staff keys can perform Staff review operations but cannot impersonate the commissioner. The legacy `WEBSITE_ADMIN_KEY` remains a commissioner credential; do not distribute it to assistants.

`/promo` posts the LEAGUEbuddy recruitment message and invite with currently unassigned teams grouped by East/West and division. It rescans Discord coach assignments every time and sends one public embed without pinging members.

`/website` posts the configured league website link and an Open Website button. Set `WEBSITE_URL` or use Railway's public domain.
