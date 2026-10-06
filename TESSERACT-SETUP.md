# Hosted screenshot processing — no API key

The default processor is now Tesseract.js, running inside the LEAGUEbuddy server. English recognition data and the WebAssembly engine are installed with npm. No OpenAI key, Apple tools, system Tesseract installation, or runtime language download is required. Coaches only need Discord. The server still needs CPU, memory and persistent storage.

## Run locally or deploy

Run `npm install`, `npm run check`, then `npm start`. Existing environments can use `npm ci`. Restart is required; no slash-command changes were made in this step.

The Dockerfile uses Node 22 and installs production dependencies, including Sharp and Tesseract. A hosting service can build it directly. Configure the existing Discord credentials and public WEBSITE_URL as environment variables. Mount persistent storage at `/app/data` (or configure the existing data paths). The Docker image intentionally excludes `.env` and `data`: seed the volume with your league, ratings snapshots and player assets before starting. Back up the whole data volume, including `fantasyhq/game-history`.

Only one bot process should use a JSON data directory. OCR uses a worker thread and processes one game at a time, with at most eight jobs admitted. If busy, originals remain stored and the submission can be retried. Each OCR job has a three-minute processing timeout. Restart-interrupted jobs can also be retried from stored images.

## Coach workflow

1. A staff member links an existing private game thread with `/game setup week:1 team:MIL`. Rerun setup on an existing thread to refresh its buttons. Automatic thread creation is not part of this change.
2. Coach A clicks **Submit Score**, then uploads their team's Association Box Score.
3. The thread shows **1 / 2** and waits for the other coach. Coach A cannot fill the other team's slot.
4. Coach B clicks **Submit Score**, then uploads their own team’s box score.
5. The server reads both originals, verifies team identity, scores, statistics, confidence, and roster matches.
6. A clean two-coach submission writes the final score, winner, team stats, player stats and DNP list together in the permanent Game record, then locks the game. DNPs are not played appearances. Repeated finalization cannot duplicate stats.
7. Unclear cells, wrong screenshots, missing roster matches or inconsistent totals keep the game unfinalized. The originals and extracted values stay available for review or a new two-coach submission. The existing review page remains read-only; correction/approval controls are not implemented.

Legacy attempts where one coach uploaded both screenshots remain accessible and can be reprocessed. They never auto-finalize: official results require one recorded upload from each team’s coach. Each new attempt preserves all previous media and extraction history.

## Actual screenshot verification

Automated tests now run Tesseract on the supplied JPGs, not mocked OCR. The default engine reads Cleveland 116 / Milwaukee 120, both sets of quarter scores, all team totals, 20 played player rows and eight DNP rows. The chosen numeric values and displayed names match the checked fixture.

The Bucks sample still produces five conservative confidence warnings (three disagreement warnings and two low-confidence names). Correct-looking output is not permission to ignore uncertainty: that sample stays in review until a clearer submission or future review workflow resolves it. Current league rosters must also contain the screenshot players; these custom sample rosters can differ from the default imported rosters.

The template targets full, uncropped 16:9 MyNBA Association Box Score screens like the samples. Nonmatching layouts fail clearly. Overtime layouts are flagged for review; the normalized model already supports arbitrary periods, but the OCR layout currently reads four regulation quarters. Photos, cropped tables, changed UI layouts and reduced-quality images may need a clearer upload.

Temporary crops and resized versions exist only in memory. Originals are never edited. Every recognition's raw text, positions, crop bounds, alternative readings and confidence are retained. No values are changed merely to balance totals.

## Storage

`data/fantasyhq/game-history/<gameId>/record.json` retains Game, GameSubmission, GameMedia and BoxScoreExtraction history. A final game additionally contains `game.result`, `playerGameStats`, `teamGameStats`, and `dnpPlayers`. Result/stat writes are atomic in the same JSON record. The authenticated review API exposes these records; Discord thread deletion does not touch them.

No standings, league leaders, season averages, week advancement or automatic game-thread creation was added.

References: [Tesseract.js](https://github.com/naptha/tesseract.js), [OCR quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html).

## Commissioner review and correction

Open the existing **Review Game** website link in the Discord submission message. The review page uses the same commissioner website key saved by the main site's Admin tools. It displays week/matchup, scores, both original screenshots (with full-size links), editable player tables and team totals, and validation warnings.

1. Enter your commissioner name for the correction log. Authentication remains the existing shared website key; this entered name is an audit label, not a verified Discord identity.
2. Compare values against the originals. Correct scores, quarter scores, player stats, shooting splits, team totals or DNP flags. Resolve unmatched players using the corresponding team's extraction-time roster snapshot; saved records use permanent player IDs.
3. Check each confidence/uncertainty warning only after verifying it against the original. Mathematical errors cannot be dismissed with a checkbox.
4. Select **Save corrections & revalidate**. This creates a new revision and reruns validation; it does not finalize the game.
5. When every blocking warning is resolved, select **APPROVE GAME**. This uses the existing finalization pipeline to save the score, team stats, player stats and DNPs atomically. Finalized games are read-only.

The history section retains original extraction output and all corrected revisions, with parent revision, commissioner label and timestamp. Original files remain unchanged. Stale tabs cannot overwrite a newer revision. Discord thread deletion does not delete game history or screenshots. This page does not add standings or week advancement.

Validation: `npm run check` runs the full test suite. `node scripts/review-browser-smoke.js` runs an additional Playwright smoke test with fixture data (requires the Playwright Chromium browser), checking image display and correction submission without touching a live league.

## Active-week private game threads

In the existing website **Admin → Active-week game threads** panel, use your commissioner website key, refresh channels, select the existing Games text channel, and save it. Start the regular season, then select **Create missing threads** or use **/games create** in Discord. The command uses the existing Commish / Assistant Commish / Manage Server permission checks. No channel is created and no staff permissions are elevated.

The bot synchronizes existing team-role ownership, creates one private thread per scheduled active-week game, adds both owners and all members with LEAGUEbuddy Commish or LEAGUEbuddy Assistant Commish roles, and posts the existing Submit Score controls with the matchup and shared deadline. Bye teams get no thread. Linked threads are reused, including manually linked threads. Failed member/message steps retry in the same thread; individual errors appear in the website panel and server log.

Week activation now saves `startedAt` and `deadlineAt = startedAt + 48 hours`. Existing active weeks without a timestamp get a single persisted start time on their first creation run. Retries never restart the clock. Discord archive duration is independent of this deadline; no deadline enforcement or week advancement is added.

The bot needs View Channel, Create Private Threads, Send Messages in Threads and Read Message History. Coaches need access to the parent channel and permission to send in threads. Both staff-role memberships are refreshed when creation is retried, including for existing linked threads. See [Discord thread permissions](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx).

Use the integrated `npm start` process for website controls; standalone `start:web` has no connected Discord bot. This project uses a single bot process with its existing JSON storage. If Discord creation has an ambiguous network failure or the process stops during creation, automatic recreation is blocked to avoid duplicates; inspect Discord and use the existing `/game setup` in the created thread to recover its Game link.

## Lightweight game activity

Game records now retain per-team participation, last activity time/user and approximate counts, plus overall last activity, thread creation time and persisted reminder markers. Message text and conversation histories are never stored. Bot messages and users who do not own either scheduled team do not count. Messages (including screenshot uploads) and game buttons count for the owning coach. Tracking starts when this feature is enabled; it does not backfill old conversations.

The existing matchup card and Admin game-thread list show participation, derived game status and the week deadline. Cards change on meaningful state changes; ongoing conversation can refresh last-activity displays at most once per 15 minutes. Discord timestamps handle the visible countdown without minute-by-minute message edits.

A once-per-minute check uses the saved week deadline, including after restart:
- At 24 hours remaining, remind coaches who have not participated; skip if both participated.
- At 6 hours remaining, warn unfinished games with participation context.
- Two submitted screenshots stop coach inactivity reminders while processing/review is pending.
- At the deadline, unfinished games receive a commissioner-review flag/card, without coach mentions or automatic forfeits. Submitted games awaiting approval still appear as submitted and flagged for commissioner attention.
- Finalized games receive no reminders.

Reminder attempts are marked before sending, avoiding duplicate alerts across restarts. Failed or interrupted sends remain recorded rather than being repeatedly retried. If the bot was offline across multiple thresholds, it sends only the currently relevant alert. Reminder markers and activity survive Discord thread deletion with the existing permanent Game record. No standings, strikes, cleanup or advancement is added.

Recognition update: full-screen images are identified by the positioned NAME/Total rows, at least eight stat headers and at least three quarter-score labels. A garbled red Association title no longer rejects an otherwise valid table. The 4K Cavaliers/Heat user uploads are regression fixtures (133–130); originals are never altered. Failed extraction pages display both stored originals.

Player resolution is restricted to the detected team's saved roster. Exact names and initial/surname matches take precedence. A unique one-edit surname match (including adjacent transposition) can resolve automatically only with a matching first initial, sufficient surname length, a score of at least 0.75 and HIGH input confidence. Longer two-edit surnames are offered as review candidates. Ambiguous matches, wrong initials and low-confidence names require review. OCR display names are retained, with match method and score recorded separately; cross-team searches are not used.
