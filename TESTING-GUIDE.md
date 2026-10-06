> Updated setup: `/league create` now imports rosters and free agents automatically. Add `test_mode:true` for solo testing; season defaults to 1. Skip the initial `/roster import` steps below unless creation reports an import failure. Existing league IDs cannot be overwritten.

# 2K app testing guide

Work through these stages in order. They follow the implemented app flow, not a recovered version of the earlier development roadmap. Check each box as it passes. Record the exact command or button, expected result, actual result, and terminal error when something fails.

## 1. Prepare a test session

Use a test Discord server if possible. Your bot must already be installed there, and your account needs Manage Server permission for administrative commands. Use a new league ID such as `2k-test-01` so edits do not affect your existing league records.

Creating a league also changes which league that Discord server uses. If you use the existing server, first run `/league setup` and record its league ID and season so you can restore the binding afterward. This workspace currently has a `2kratings-current` league with season `2026`.

From the project folder, check `.env`:

```env
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-bot-application-id
GUILD_ID=your-test-discord-server-id
PORT=3000
WEBSITE_URL=http://localhost:3000
WEBSITE_ADMIN_KEY=your-private-test-key
```

Keep real credentials in `.env`. The website and Discord bot use the same `GUILD_ID` and local league files. `localhost` links work on the computer running the app; people on other devices need a reachable website URL.

Run:

```bash
npm run check
npm run deploy:commands
npm start
```

- [ ] Checks pass. The current suite has five tests, including setup, preseason, schedule persistence, and 1,000 schedule generations.
- [ ] Command registration succeeds for the selected server. This replaces that application's registered commands in that server with the current command list.
- [ ] The terminal reports the website listening and the bot logged in.
- [ ] Open http://localhost:3000 and confirm the page loads.
- [ ] Open http://localhost:3000/health and confirm a successful response.

`npm start` runs both the bot and website. Do not also run `npm run start:web` on the same port. Use `npm run start:web` only when you want the website without the Discord bot.

## 2. Check ratings and draft browsing

These features can be tested before league setup.

In Discord, type the commands and select the supplied options/autocomplete results:

| Test | Expected result |
| --- | --- |
| `/ratings team` → Milwaukee Bucks | Roster from the local ratings snapshot |
| `/ratings player` → choose a player | Ratings profile for that player |
| `/ratings top` → limit 10 | Ten players ordered by rating |
| `/ratings top` → position PG | Players whose first or second position is PG |
| `/freeagents` → limit 10 | Free-agent ratings list |
| `/toptenpreview` → choose CUS03 | Early-preview player card with browsing controls |
| Browse the preview and use Full Profile | Correct player/class opens on the website |

The current September 29 snapshot has 30 teams, 536 roster entries, and 117 free agents. These are reference counts; later scrapes may change them. `/ratings` reads source snapshots, so league roster edits should not change those results.

On the website:

- [ ] Switch among CUS01, CUS02, and CUS03.
- [ ] Each class shows its 10-player early preview and 75-player big board.
- [ ] Search for a player, clear the search, and try position filters.
- [ ] Open a prospect and check name, scouting report, strengths, weaknesses, and statistics.
- [ ] Check portraits for missing/broken images and note affected players.
- [ ] Sort and filter the Stats Center; confirm rows and profiles match.
- [ ] Open a profile through its URL, refresh, and verify the intended class/player loads.
- [ ] Try a narrow browser window and confirm menus, cards, tables, and dialogs remain usable.

Recruiting and transfer-portal commands are hidden until matching class data is available.

## 3. SETUP: create and populate the test league

Run these in Discord. Enter values through Discord's command fields; the lines below show the intended arguments.

```text
/league create league_id:2k-test-01 league_name:2K Test League season_number:1
/league setup
/league setup
/league setup
```

- [ ] Status shows the test league in `SETUP`.
- [ ] Validation reports missing rosters, owners, and schedule. Those failures are expected at this point.
- [ ] Refresh the website; its league title now matches the test league.

Import the initial roster data:

```text
/roster import
/league setup
/team list
/team roster team:Milwaukee Bucks
/player player:<choose an imported player>
```

- [ ] All 30 teams have imported rosters.
- [ ] The website player directory populates after refresh.
- [ ] Search, team, conference, position, and OVR sorting work in the player directory.
- [ ] Clicking a team or player opens the correct details.
- [ ] Discord and website show the same imported player information.

Run the initial `/roster import` before custom edits. It replaces league player and membership data; it is not a merge of your manual changes.

Test owner assignment:

```text
/team assign team:Milwaukee Bucks user:<your Discord account>
/team list
/team unassign team:Milwaukee Bucks
/team assign team:Milwaukee Bucks user:<your Discord account>
```

- [ ] Assignment appears, disappears, and returns in the team list and refreshed website.

For solo testing, permit the other teams to remain unassigned:

```text
/league settings require_all_owners:false
```

This is a test-league setting. You can keep the requirement enabled for a league that needs all 30 owners.

## 4. SETUP: generate and confirm the schedule

```text
/schedule generate
/schedule preview
[Click Regenerate in the preview]
/schedule preview
[Click Confirm schedule in the preview]
/schedule week week:1
/schedule team team:Milwaukee Bucks
/schedule mine
/schedule full
/league setup
```

- [ ] Generation produces a preview before saving.
- [ ] Regeneration produces another valid preview.
- [ ] Confirmation saves the schedule.
- [ ] There are 15 weeks, 14 games per team, and one bye per team.
- [ ] Games stay within conferences; each week has one East bye and one West bye.
- [ ] Each week contains 14 games; the full schedule contains 210 games.
- [ ] `/schedule mine` resolves the team assigned to your account.
- [ ] `/schedule full` supplies the saved schedule download.
- [ ] Website schedule preview shows saved matchups after refresh.
- [ ] Setup validation passes. Unassigned-owner warnings are allowed with the test setting above.

Enter preseason:

```text
[Click Enter preseason in /league setup]
/league setup
```

- [ ] Phase changes to `PRESEASON` in Discord and the refreshed website.
- [ ] Running `/roster import` now fails with a phase error, because initial import is restricted to SETUP.

Existing league IDs cannot be recreated. Use `/league setup` to continue, or `/league delete` to remove a league before starting fresh.

## 5. PRESEASON: unlock and test commissioner editing

In the website Commissioner view, enter the value configured as `WEBSITE_ADMIN_KEY`, then click **Unlock**.

- [ ] A wrong key fails to load protected admin data.
- [ ] The correct key loads data issues and the audit log.

Judge authorization by whether protected data and actions succeed, not merely by the "unlocked" label: the current frontend initially treats any nonempty key as present, while the server checks the actual key.

Select Milwaukee Bucks in **Roster manager**, then click **Load roster**.

| Action | Expected result |
| --- | --- |
| Record a player's OVR, change it by one within 0–99, and save | New OVR persists after refresh |
| Look up that player using `/player` | Discord shows the edited league value |
| Look up that player using `/ratings player` | Source snapshot remains unchanged |
| Restore the original OVR and save | League value returns to its original value |
| Change a jersey number or position and save | Team details and roster show the saved value |
| Open a player profile and edit an available field | Saved field persists after reopening |
| Move a player to another team | Player appears on the destination roster and leaves the original roster |
| Move that player back | Original team membership is restored |
| Add `Test Player` with OVR 70 and position PG | New player appears in that team's roster |
| Remove `Test Player` | Player leaves the active roster; the underlying player record may remain in the directory |
| Review Audit log | Administrative changes have corresponding entries |

Restore real players' original fields before the next stage. These actions modify the test league; they do not edit raw scraped snapshots or draft-class JSON.

## 6. PRESEASON: import preview, issues, and persistence

Test refreshing an existing roster:

1. Change one real player's OVR by one and save it.
2. Select that team under **Roster import preview**.
3. Click **Preview import** and review the proposed differences.
4. Verify previewing alone has not changed the edited OVR.
5. Click **Apply import** to apply the source roster changes.
6. Reload the roster and verify the OVR matches the source snapshot again.
7. Check the audit log.

Apply import can update multiple roster fields and memberships. Read the complete preview before applying; use the disposable test league for this exercise.

Test the issue panel:

- [ ] Give two players on one team the same jersey number, save, and reload admin panels by clicking Unlock again. Expect a duplicate-jersey warning.
- [ ] Restore the original jersey number and reload panels. The warning should disappear unless another duplicate exists.
- [ ] Click **Validate preseason**. Resolve blocking errors; warnings such as unassigned owners or unusual roster sizes may remain.

Test persistence:

1. Stop the local process with Ctrl+C.
2. Run `npm start` again.
3. Refresh the website and run `/league setup`.

- [ ] League binding, phase, rosters, owners, saved schedule, and audit entries persist.

The browser retains the admin key in local storage. Clear the key field and click Unlock to remove it from that browser. Closing the tab alone does not clear it.

## 7. Optional: test the regular-season transition last

Do this only on the disposable league after all preseason testing. If the current development phase should stop at preseason, skip this section.

1. Click **Validate preseason** and confirm there are no blocking errors.
2. Click **Start season**.
3. Refresh the page and run `/league setup`.

- [ ] League phase is `REGULAR_SEASON` and current week is 1.
- [ ] The saved schedule marks week one active and later weeks upcoming.
- [ ] Clicking Start season again fails because the league is no longer in PRESEASON.

This is the implemented endpoint so far. Results, standings, week advancement, playoff execution, trades, and draft-pick execution are not yet available to test. Naming a later phase in the code does not mean its full workflow exists. Roster editing also does not yet consistently enforce phase restrictions.

## 8. Restore your usual league

If you changed the binding on your existing Discord server, restore the league and season recorded in stage 1. For the original local scaffold:

```text
/admin bind league_id:2kratings-current season_id:2026
/league setup
```

Refresh the website and confirm the original league name. Its empty rosters are expected if it was never initialized. Binding back does not delete the test league.

If you used a separate server, restore your usual `GUILD_ID` in `.env` and restart the app when finished. For another clean run, choose a fresh test league ID such as `2k-test-02` instead of resetting a populated league.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Discord commands are missing | Correct application/server IDs; run `npm run deploy:commands`, then reopen Discord's command picker |
| Bot commands do not respond | `npm start` is running and logged in; website-only mode does not run the bot |
| Port already in use | Stop the previous local app process or choose a different PORT and matching WEBSITE_URL |
| No league configured | GUILD_ID matches the server where you created the league; restart after changing environment settings |
| League appears but player directory is empty | Complete initial `/roster import` while in SETUP |
| Admin authorization required | Server key is nonempty, the app was restarted, and browser key matches it |
| Website does not reflect a Discord change | Refresh the website; there is no live push update |
| Start season is rejected | League must be in PRESEASON and pass preseason validation |
| Import or roster validation fails | Check missing source team files, player ratings, and the displayed data issues |
| Deployed website differs from local website | Verify deployed environment and persistent league files; `data/` is excluded from Git |
| Draft board fails alongside a league API error | Check terminal errors for `/api/league-site`; frontend startup currently loads league and draft data together |

When reporting a failure, include the stage, league phase, action, visible error, and relevant terminal output. Omit tokens and the admin key.

## Quick commands

- `/myteam`: your assigned roster and upcoming games.
- `/freeagents`: league free agents, with optional position and page.
- `/league setup`: setup checklist, next step, refresh, and Enter preseason button.
- `/team list`: team directory (replaces `/teams`).
- Discord player autocomplete is alphabetical across teams.

## Test role ownership

1. Enable Server Members Intent in the bot's Developer Portal settings. Give the bot Manage Roles and move its role above the team and Coach roles.
2. Register commands, restart, and wait for automatic sync. Existing owner records will be replaced by the current team-role assignments.
3. Give yourself one team role in Discord. Check `/myteam`, `/schedule mine`, `/team list`, and the refreshed website. You should also receive LEAGUEbuddy Coach.
4. Remove the team role. The team should become unassigned and your Coach role should be removed.
5. Try `/team assign` and `/team unassign`; check both Discord roles and the website.
6. Give a team role to two people. the setup checklist should report a conflict and count neither as its owner. Resolve the roles, then let automatic sync update ownership.
7. Restart the bot with an existing role assignment. The same owner should remain; this does not advance the league phase.

Owner names now show Discord display names. Change a nickname or team role and allow about one second for bot sync, then up to 10 seconds for the website label to refresh. No manual sync command is needed.

## Regular-season standings

Open **Standings** in the existing website navigation or run `/standings` (optional `conference: East` / `West`). Start with every team at 0–0. Finalize a game using the existing validated submission/approval flow; refresh standings and check GP, W/L, PCT, PF, PA and DIFF in the appropriate conference. Scheduled and review-required games must not change records. Teams on a bye remain unchanged. Click a team in the table to open its existing profile with its current W–L record. The existing Game Review page also shows both teams' current records.

Calculations read permanent Game results every time; nothing writes standings totals. Ranking is PCT, then wins, then team name and ID for a deterministic display—not formal playoff seeding. The website refreshes the visible Standings view every 30 seconds and has a manual refresh button. API and Discord requests always recalculate.

The existing review system locks finalized games. This feature does not introduce reopening or editing approved games. If an authorized result-correction flow updates the official result, the next standings calculation reflects the changed winner and score automatically. Automated tests cover this by updating an official test record.

## Regular-season week advancement

Use **Admin → Regular-season week → Refresh week status** or `/week advance`. Normal advancement requires 14 official final games. Unresolved games show matchup names, activity context and available Game Review / Discord links. The website requires the existing commissioner key and an entered audit name; Discord requires Commish, Assistant Commish or Manage Server.

Prepare advancement, review the confirmation, then confirm. This completes the old week, activates the next, updates `currentWeek`, starts one new 48-hour window and invokes the existing thread creator. Old games, threads, media and standings remain intact. Discord errors do not undo activation; retry with `/games create` or the existing website thread controls.

For an exception, use **Force advance…** or `/week advance force:true`, then explicitly confirm. The closed week's unresolved matchups are preserved on the week and in the audit log with the commissioner and timestamp. No scores or forfeits are assigned.

On Week 15 the action becomes **COMPLETE REGULAR SEASON**. It marks Week 15 completed and sets `regularSeasonStatus: COMPLETED` / `regularSeasonCompletedAt` on the existing league/season record. `currentWeek` remains 15, there is no active regular-season week, and the phase remains REGULAR_SEASON pending a future playoff transition.

Storage remains the existing single-process JSON repository. A durable write-ahead journal commits schedule, league state and audit together; repository readers recover an interrupted commit before exposing those records. No second week-state database is introduced. Confirmation tokens bind the actor, season and expected week, expire after five minutes and are cancellable. Committed request IDs are preserved in the audit log to make repeated confirmation requests harmless across restarts. If a committed write cannot finish because disk writes still fail, reads fail rather than exposing partial state; restore storage access, refresh, and retry missing threads if needed. Run only one bot process against this JSON data directory.

## Completed-week Discord thread cleanup

Use `/games cleanup week:1` or **Admin → Completed-week thread cleanup**. Load completed weeks, choose one, enter your commissioner audit name on the website, and prepare cleanup. Nothing is deleted until the explicit Delete confirmation. Cancel leaves threads intact. Discord requires existing league staff permissions; the website uses the existing commissioner key. ACTIVE and future weeks are blocked, including when the week status changes after preparation.

Deletion removes only the saved private Discord channels. Game records retain original `discordThreadId`, `threadCreatedAt`, scores, stats, extractions, submissions, activity and screenshot files. Added fields are `discordThreadCleanedAt`, `discordThreadCleanedBy`, `discordThreadCleanupOutcome` (DELETED or MISSING), and `discordThreadDeletedAt` only for actual successful deletion. Historical Game Review continues to load saved records and originals, displaying “Cleaned after Week N”.

The summary reports deleted, already cleaned/missing and failed counts. Successful deletions remain committed if another thread fails. Fix Discord permissions and prepare cleanup again to retry failures; previously cleaned threads are skipped without Discord requests. Missing channels count as already missing, not fatal errors. Other lookup errors remain failures. Shared thread IDs, foreign-server channels and non-private channels are blocked. Requested/completed audit events retain actor, league, season, week, timestamp, request ID and counts. Repeated confirmation requests replay the stored result; a fresh preparation retries failures.

Automated coverage: `node --test test/game-thread-cleanup.test.js` uses temporary repositories and mocked Discord channels. It checks 14 deletions, byte-for-byte original image retention, full permanent record equality apart from cleanup metadata, standings/schedule invariance, permissions, confirmation/cancellation/expiry, active/future restrictions, idempotence, partial failures, retry scope and historical review/media routes. `npm run check` runs the entire regression suite. No automated test deletes live Discord threads. Register the updated commands and restart the bot when ready to use the new controls.

## Discord channels and Trade Committee role

New `/league create` setup creates four LEAGUEbuddy roles (Coach, Commish, Assistant Commish, Trade Committee), 30 team roles, a `LEAGUEbuddy 2K` category and the agreed 16 `lb-` text channels. Existing leagues use `/league setup` → **Create / repair channels**. Only existing commissioner/admin permissions can invoke this action. The bot needs Manage Channels and Manage Roles; its role must be high enough to manage the relevant roles and channels.

Channels: league-staff, announcements, chat, available-teams, schedule, standings, game-threads, scouting-hub, activitycheck, submit-trade, trade-block, trade-counts, trade-committee, trade-proof, approved-trades, denied-trades. Staff and the bot can post throughout. Coaches can discuss in chat/scouting/activity/submit-trade/trade-block/trade-proof; feeds are read-only. Staff is private to commissioners; trade-committee is private to commissioners and the Trade Committee role. Assign committee members manually in Discord; committee membership does not grant league administration permissions.

Setup saves channel IDs under league settings `discordChannels`, and connects game-threads to existing `gamesChannelId`. Repeated setup reuses saved IDs even after renames. Without a saved ID it reuses a unique channel with the exact default name; ambiguous names or wrong channel types report errors. Reused channels keep names and locations but receive the defined permission overwrites. Deleted channels are recreated. Partial failures keep successful mappings and can be retried. Each completed attempt is audited. Existing games and permanent game history are untouched.

Channel creation does not implement trade processing or automatic publishing to other feeds. Only the existing Games channel integration is connected by this change. Tests use mocked Discord APIs; no live server channels are created by automated checks.

Confirmed access policy: visitors can view announcements and available-teams, but cannot post or create/reply in threads there. All other league channels remain hidden from visitors. Commissioners and assistant commissioners have equal channel access. The Trade Committee role grants the private committee room only; its members need Coach for the other league/trade channels. Trade submissions and proof are visible to all coaches. Activity check remains unchanged. Schedule, standings, trade counts, approved/denied trades and the two public feeds allow staff/bot posting only, including thread replies. The game-threads parent blocks coach posts and thread creation while allowing invited coaches to talk and upload screenshots in private game threads. Server owners and Administrators bypass Discord channel restrictions. Apply updated overwrites using /league setup → Create / repair channels after restarting the bot.

Schedule generation is now available directly in `/league setup`: click **Generate schedule**, browse the 15-week preview, then **Confirm schedule** and **Back to setup**. An existing pending preview is reopened rather than replaced. The button requires imported rosters, is disabled once a valid schedule is saved, and is available only during SETUP to league staff. Regenerate and Cancel remain in the preview. Confirming saves the schedule; entering preseason is still a separate setup button. Existing `/schedule` commands remain available.

Discord regular-season start: during PRESEASON, staff open `/league setup` → **Start regular season**. Existing preseason validation runs before a commissioner-bound confirmation is shown and again when confirmed. Confirm starts Week 1's 48-hour clock through the existing league service and audit log. Cancel, expired confirmations and stale league/season buttons do not start the season. Use `/games create` afterward to create private matchup threads. The website start control remains available.

Updated matchup creation: all 14 scheduled private threads are created regardless of vacant teams or ownership conflicts. Opening messages tag the two saved team roles with an explicit mention whitelist. Existing human role holders and league staff are added as thread members; role mentions alone do not grant private-thread access. Rerun `/games create` after assigning team roles to add new holders without duplicate threads or repeated opening pings. Ownership validation for score submissions remains in place. Run Create / repair channels once after this update so the bot has Mention Everyone in the Games channel (needed to notify non-mentionable team roles); only the two matchup roles are allowed in opening-message mentions. Discord permission/API errors can still prevent individual operations and are reported for retry.

Countdown timing update: activating a season/week does not start its deadline. The shared 48-hour window starts with the first successfully created/linked matchup thread in that week's creation batch. All games use that same deadline. If no thread can be created, no countdown starts; retries and creation of remaining threads do not extend it. Previously launched weeks retain their deadline, while an older active week with no linked threads starts its clock when threads are first created.

Matchup controls: Submit Score retains one screenshot per coach. Staff Submit permits Commish/Assistant Commish (or existing Manage Server authorization) to upload both screenshots for any matchup, including CPU games. Staff upload sessions cannot mix with an in-progress coach collection. The saved submission identifies the staff member and the existing audit log records session creation. Both originals pass the same OCR, roster matching, stat checks and finalization; commissioner corrections remain available. No button fabricates scores or standings.

Fair Sim records agreement from both coaches, or staff approval. The two Forfeit buttons name the winning team and use its application emoji; a coach can only concede to the opponent, while staff can select either. Decisions are retained in game history, separately from official results. CPU reports automatic classification from current ownership: zero owned sides means CPU vs CPU; one means human vs CPU. Test leagues remain TEST; legacy leagues with vacant-owner setup enabled are treated as tests until an explicit testMode setting exists. No strikes, streaming or Game Completed button were added. Refresh existing matchup cards with /games create after restarting.

NBA player directory now shares draft-section horizontal padding and grid gap, so portrait dimensions, card borders and corners align at the same viewport width.


### Review feedback and cleanup of unfinished weeks
- Open a submission review, enter the website key and load it. Leave commissioner name empty and press Save corrections & revalidate: the page should focus the name and explain the requirement beside the actions.
- Review items name the team, player and stat. Show in table focuses the corresponding field. For OCR confidence warnings, verify against the original and tick Matches the original screenshot; mathematical errors require corrected values.
- Save reports success or an error beside the buttons. Approval stays unavailable until a saved revision passes validation. Approval then records the result, stats and standings.
- In Admin → Weekly thread cleanup, Load weeks and select any scheduled week, or use `/games cleanup week:<number>` in Discord. Preview and confirm deletion to remove all linked game threads from that week, regardless of completion. This does not complete games or advance the week.
- Saved results, submissions, images and stats remain available. Automatically creating current-week threads again skips intentionally cleaned threads.


### Permanent league deletion
`/league delete` now removes the league folder and every matching game archive across all seasons, including original screenshots, OCR revisions, submission history and game stats. The confirmation describes this scope. Shared source ratings, draft classes and image assets remain, as do Discord channels, threads, roles and assignments. Other leagues are unaffected. This applies to future deletions; it does not automatically purge archives from leagues previously deleted.

### Game date and approval confirmation
- Restart the bot; active game cards refresh on the activity tick. `/games create` can refresh existing active-week cards immediately without duplicating them.
- A matchup without a date shows only **Set game date**. A matchup coach or staff member clicks it and enters the date shown inside NBA 2K, e.g. `10/24/2027`. This is not a real-world scheduling date and does not change the 48-hour deadline.
- A saved date appears bold under **NBA 2K GAME DATE**. Edit game date remains first; submission, staff submission, processing, Fair Sim, forfeits and CPU controls become available. Invalid calendar dates, unrelated users and wrong threads are rejected. Finalized games cannot have their date edited.
- On the website, successful approval immediately opens **Game approved**, then leaves an **APPROVED ✓** disabled button. A failed approval displays its error and never shows a success popup. If approval succeeds but reloading the page fails, the confirmation remains and explains that a refresh is needed.
