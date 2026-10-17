> Updated October 17, 2026: the separate free agency offer/waiver workflow described in this historical document has been retired. See [Roster reconciliation](ROSTER-RECONCILIATION.md) for the current process.

# LEAGUEbuddy feature audit — October 9, 2026

The feature set is broadly implemented and covered by automated tests. Production is healthy and usable for setup, but **the official league cannot yet start its regular season: 29 of 30 teams exceed the required 15-player roster**. Five teams currently have coaches; vacancies do not block activation or season start.

This was a read-only feature audit. No application source, league records, Discord configuration, command registrations or deployment settings were intentionally changed. Only this report and ignored audit evidence were created. Existing uncommitted promo/documentation/test changes were preserved and included when testing the working tree.

## Scope and evidence

- Audited local branch `repair/launch-readiness`, HEAD `32e7e54`, plus the existing working-tree changes. This is not a claim that HEAD alone reproduces production.
- Ran syntax checks, TypeScript and the complete test suite in a temporary copy without `.env` or live league data. The suite contained **657 tests**: 639 passed initially and 18 browser/localhost tests were blocked by sandbox permissions. All 18 passed in permitted isolated reruns; those reruns executed 33 tests including repeated checks. The original full-run exit code was nonzero and is retained in the evidence; this was split-run verification, not one clean full-suite invocation.
- Production dependency audit: **zero known vulnerabilities** at the time of inspection.
- Read Discord channel, role, registered-command and selected pinned-message metadata using GET requests only. No interactions were clicked or messages posted.
- Read production `/health` and public `/api/league-site`. `/health` returned `{"ok":true}`; the league summary returned HTTP 200. No authenticated production mutation endpoints were exercised.
- Confirmed remote GitHub heads using `git ls-remote`: `main` is `f1c40ed`; the repair branch is `32e7e54`.
- Relevant later requirement: attachment `7cd91574` explicitly specifies ten postseason participants per conference, an NBA-style Play-In for the final eight, and best-of-3/5/5/7 rounds. It supersedes the earlier eight-seed-only answer. The postseason engine implements that later format.

Evidence is saved under [reports/feature-audit-2026-10-09](reports/feature-audit-2026-10-09), which is ignored by Git and excluded from deployment uploads. It contains test logs, dependency results and selected read-only production/Discord snapshots. No credentials were saved in the audit outputs.

## Feature inventory

“Exercised” below means source inspection plus relevant automated fixture/browser tests. A visible live pin verifies discoverability, not successful multi-person interaction.

| Feature | Audit result | Verification / limitation |
| --- | --- | --- |
| League creation, roles, ownership, setup | Implemented; exercised | Official league has 30 teams, 652 total players, five owners and a saved 15-week/210-game schedule. Current phase is SETUP. Activation supports vacant CPU teams. Regular-season validation correctly blocks oversize rosters. |
| Coach identity / MyTeam / My Week | Implemented; exercised | Shared role ownership and private command replies; website weekly view omits private transaction details, Discord includes the coach's own pending work. Live role revocation and team reassignment still need a two-account acceptance test. |
| Scheduling, game threads, dates, activity | Implemented; exercised | Fifteen conference round-robin weeks, 48-hour windows, game-date parsing, private threads, participants/Staff and streaming reminder controls. Production season has not started, so real weekly creation/closure is unverified here. |
| Game submissions, OCR, Staff review | Implemented; exercised | Screenshots and phone-photo fixtures, HEIC normalization, contract images, correction history and protected evidence routes. Browser review tests passed. This does not guarantee accurate extraction from every phone, glare, tilt or unreadable image; uncertain fields still require review. |
| Standings, player/team stats and leaders | Implemented; exercised | Shared approved-game logic, publication on week advancement, percentage qualification and historical scopes. Live standings and stats pins exist. No production game was finalized or week advanced during the audit. |
| Weekly Staff reporting / advancement / cleanup | Implemented; exercised | Report buttons delegate to existing advancement/cleanup services; confirmation and stale-action tests pass. No active weekly report is expected while the league remains in SETUP. |
| Trades, valuation, committee, proof, trade block | Implemented; exercised | Ownership checks, contracts, transaction locks, committee decisions and proof receipts. Current pending proposal delivery uses private participant threads. Live Build a Trade pin exists; real two/three-coach interactions and denied-DM behavior remain unverified. |
| Regular-season free agency / waivers | Implemented; exercised | Contract photo review, bidding windows, conditional release, signing limits and 85+ release protection. Live SIGN FREE AGENT and MY ACTIVE OFFERS controls exist. Actual timed winner delivery was not triggered. |
| Player upgrades | Implemented; exercised | Coach-submitted-side eligibility, Staff decisions, atomic updates and private history/eligibility. Multi-account live submission/approval remains an acceptance gate. |
| Scouting / weekly and live mock drafts | Implemented; exercised | Season-to-CUS01–04 mapping, fixed weekly projections, live lottery/order controls, team needs, contract-aware fit, menus and recaps. Live START LIVE MOCK pin exists. Live timer behavior, owner selection and DM recap delivery need actual interaction testing. Seasons beyond the four supplied classes require additional content. |
| Postseason / awards / Player of the Week | Implemented; exercised | Ten seeds, Play-In, eight-team bracket, 3/5/5/7 series, confirmations, forfeits, correction conflicts, official awards and browser views. Legacy setup fields contradict the engine; see FA-03. |
| Offseason / contracts / draft / progression | Implemented; exercised | Ordered stages, retirement/order/draft/options review, offseason FA, protected cutdowns, progression and rollover. Isolated complete lifecycle tests ran; no production offseason was entered. CPU-team roster maintenance still requires Staff oversight. |
| News / Power Rankings / streams | Implemented; exercised | Verified-event sources, Staff article review, spacing and caps, historical rankings, stream links and betting lock. Live production publishing was not triggered. |
| Sportsbook | Implemented in Discord; exercised | Website betting routes retired; wallet/ledger, wagers/parlays, own-team checks, settlement/corrections and Staff review tested. Live Staff Review pin exists. No live wager or payout was made. |
| Test Mode / reset / restore / backups | Implemented; exercised | Isolated simulation and full lifecycle, checkpoints, restore, single-writer safety and checksum verification. Live Test Mode, Live Resets and Sportsbook Staff panels each appear once in the inspected Staff pins. Independent off-volume disaster recovery is not proven by same-volume backups or fixture tests. |
| Website navigation / public entry points / promo | Implemented; exercised | Browser navigation, mobile overflow, filters, histories, admin confirmations and review caching passed. `/website`, `/availableteams` and `/promo` registered. Latest promo is plain text followed by live open-team names; its latest source is not committed. |

## Prioritized findings

### FA-01 — P1 launch gate: authoritative production rosters are oversize

**Verified live data, not an inferred local-data problem.** Production league `LB-official` is in SETUP. Roster distribution: one team has 15 players, four have 16, six have 17, eleven have 18, seven have 19 and one has 21. The preseason validator reports 29 blocking roster errors.

The start guard is behaving as designed. The required next step is commissioner-approved cutdowns/reconciliation for **all teams, including CPU teams**. Do not automatically delete players to make validation green. Preserve membership history and protected-player rules. Use the existing website roster controls, then rerun validation and review the resulting free-agent pool.

**Acceptance:** all 30 teams have exactly 15 distinct active players, no missing players/required ratings/positions, and regular-season validation passes with the existing five coaches.

### FA-02 — P1 operational risk: deployed promo source is not reproducible from a committed revision

The latest requested promo and its shared ownership-filter changes are deployed from the working tree. `git show HEAD:src/fantasyhq/discord-promo.js` still shows the older embedded promo. Both remote branches match their committed heads, not the latest deployed working tree; `main` is additionally behind the repair branch.

This creates an avoidable risk during rollback, a clean checkout or deployment from the wrong branch. The current healthy bot is not itself failing because of this. Railway's current GitHub source-branch selection was not independently verified in this pass; do not assume it follows the repair branch.

**Repair:** commit and push the tested pending changes on the intended branch, record the corresponding deployment, and inspect Railway's configured source before enabling automatic deployments. Do not merge branches as part of this audit.

**Acceptance:** a clean checkout of a recorded revision reproduces the current promo and source changes, and the deployment source points to the intended branch/revision.

### FA-03 — P2: setup exposes misleading postseason settings

[discord-setup.js](src/fantasyhq/discord-setup.js:177) says “8 teams per conference”; `/league settings playoff_teams` offers only 8. [setup-service.js](src/fantasyhq/setup-service.js:34) stores that value and best-of-seven defaults for every round. The authoritative [season-transition.js](src/fantasyhq/season-transition.js:23) and [postseason-state.js](src/fantasyhq/postseason-state.js:1) instead use the later requested ten-seed Play-In and 3/5/5/7 series.

The website's ten-seed instruction matches the later requirement. The defect is the contradictory, effectively non-controlling settings display and stored defaults.

**Repair:** display one authoritative format consistently and remove or retire options that imply unsupported configurability. Preserve existing postseason history. Add a cross-surface regression linking displayed rules to the engine.

### FA-04 — P2: two live channels are named `lb-chat`

Verified one under `lb-community` and another under `lb-league`. Both are live channels, rather than duplicate test data. This splits conversation and makes directions ambiguous.

**Repair:** choose one league conversation channel and give the community channel a distinct purpose/name, or consolidate after reviewing its history and permissions. Do not automatically delete either channel.

### FA-05 — P2 security hardening: the live bot still has Administrator

Read-only role inspection confirms the bot has Administrator. Staff and Trade Committee channels deny View Channel to `@everyone` and explicitly allow their relevant roles; no public-access leak was established by those overwrites.

Administrator expands the impact of a compromised bot credential and bypasses channel permission boundaries. This is a hardening issue, not evidence of compromise.

**Repair:** verify the required role/channel/thread/attachment/pin/mention permissions in a disposable guild, then remove Administrator only after setup, role assignment, private threads and pin recovery pass with the narrower permissions. Do not remove it blindly in production.

### FA-06 — P2 usability: setup understates channel count

[discord-setup.js](src/fantasyhq/discord-setup.js:48) says repair creates 18 league channels, but `discord-channels.CHANNELS.length` is 25. Production has those 25 league text channels plus community/voice channels and categories, totaling 35 channels/categories. `lb-time-off` is correctly last in the league category.

**Repair:** derive the displayed count from the channel definition, and keep Staff-only tools clearly separate from coach entry points. Consider grouping trade-result feeds and season-result feeds into categories to reduce scanning; keep their existing IDs/history until an approved layout change.

### FA-07 — P2 operations verification gap: slow handoff is not yet proven resolved

Startup acquires the writer lease and creates a backup before starting HTTP. A stale foreign heartbeat can deliberately delay startup for up to two minutes. The recently configured 30-second Railway draining variable and local signal-release tests improve the intended shutdown path, but this audit did not restart containers or inspect the mounted lock directly.

**Repair/verification:** on a separately authorized deployment, measure old-process signal receipt, lock release, backup duration and time until HTTP is listening. Check the effective start command and draining behavior. Keep single-writer protection and truthful readiness; do not clear a live lock or advertise health before initialization finishes.

An initial Railway retry can occur normally. Repeated two-minute waits should be investigated, rather than treated as proof that the shutdown setting worked.

## Release acceptance still required

These are unverified production behaviors, not additional confirmed defects:

1. Real coach A / coach B / Staff permissions: team reassignment, role revocation, private panels, opponent-only threads, private trades and committee review.
2. One genuine phone-photo game upload per side: review, correction, approval, thread signal and upgrade eligibility. Repeat with HEIC and a direct screenshot.
3. Weekly closeout: CPU/CPU, coach/CPU and coach/coach counts; one confirmation; one advancement; published standings/stats; next-week threads; cleanup confirmation without deleting history.
4. Live mock: mapped season class, order/lottery controls, actual owner pick, timer/autopick, one final recap and successful/failed DM delivery paths.
5. Regular-season FA and trades: real participant actions, ownership changes, timed close, required proof and final roster consistency.
6. Backup copied outside the Railway volume and restored into a separate environment, with originals and history verified.
7. Railway clean shutdown/startup and deployment-source consistency.

Do not use live reset, simulated trades, automatic roster cuts, a forced week advance or a deployment as an audit probe.

## Repair order and recommendation

1. Reconcile the 29 oversize production rosters with commissioner approval; this is the current regular-season start blocker.
2. Make the deployed working tree reproducible in GitHub and verify the deployment source.
3. Unify postseason settings/displays and derive the channel count.
4. Resolve the duplicate chat purpose; review channel grouping without deleting history.
5. Verify narrower bot permissions and actual multi-coach workflows.
6. Complete independent recovery and shutdown-handoff evidence.

**Feature audit result:** broad implementation and automated coverage; no P0 runtime outage observed. **Regular-season launch recommendation: NOT READY until the roster gate is resolved and the remaining live acceptance evidence is collected.** This report assigns no new numerical readiness score: passing fixture tests alone does not measure live feature readiness.

No repairs, merge, push or deployment were performed during this audit.
