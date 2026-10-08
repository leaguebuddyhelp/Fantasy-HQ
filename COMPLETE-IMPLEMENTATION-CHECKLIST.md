# Complete implementation audit — October 8, 2026

Source of requirements: latest COMPLETE GITHUB COPILOT IMPLEMENTATION PROMPT (attachment 7cd91574), superseding ddebda92, plus subsequent user corrections. Existing local available-teams/channel changes are preserved. The status tables record the initial inspection; the implementation-progress section below records subsequent changes.

## EXISTING — reuse these systems

| System | Actual implementation / integration |
| --- | --- |
| JSON storage | `src/fantasyhq/repository.js`: validated reads, fsync + atomic rename, recoverable trade/week/upgrade/reset journals. `storage-safety.js`: single writer, checksummed backups/restoration. |
| Identity and ownership | Permanent player/team/pick/game IDs; membership history; `role-ownership.js`, `coach-identity.js`, `discord-permissions.js`; explicit commissioner and Staff authorization. |
| Setup and schedules | `setup-service.js`, `schedule-generator.js`, `schedule-validator.js`, `preseason-validator.js`, `league-service.js`; 30 teams, 15 weeks, conference round robin, commissioner advancement. |
| Games / OCR | `game-submissions.js`, `box-score/service.js`, `tesseract-provider.js`, `normalize.js`, `learning.js`, `review-service.js`, `finalize.js`; originals, duplicate hashes, bounded workers, review/corrections, persistent game records. |
| Shared statistics | `official-game.js`, `player-stats-service.js`, `team-stats-service.js`, `standings-service.js`, `stat-scope.js`; published regular-season snapshots and distinct PLAY_IN / PLAYOFFS scopes. Website stats routes and Discord feeds use these services. |
| Trades | `trade-service.js`, `discord-trades.js`, `asset-valuation.js`, `transaction-locks.js`: valuation/fairness, verified ownership, committee votes, execution proof, delivery receipts, phase/season limits. |
| Regular-season FA | `free-agency-service.js`, `offer-score.js`, `discord-free-agency.js`: screenshot contract review, timed windows, improvement/withdrawal, conditional releases, Staff waivers, privacy, announcements. Preserve this independently of new offseason stages. |
| Player upgrades | `player-upgrades-service.js`, `discord-player-upgrades.js`: entitlement/progress, coach authorization, Staff decisions, atomic player changes and audit history. |
| Scouting / mocks | `scouting-service.js`, `mock-engine.js`, `mock-storage.js`, `mock-simulations.js`, `live-mock-service.js`, `discord-mock-draft.js`: four classes, 1,000 simulations, AVP, private scouting, timers, rooms, portraits, final recaps and verified ownership. |
| Postseason | `postseason-state.js`, `postseason-service.js`, `season-transition.js`: ten seeds/conference, NBA-style Play-In, fixed brackets, best-of-3/5/5/7, approval, advancement, conflicts, championship records. Already implemented; do not rebuild. |
| Official awards | `awards-service.js`, `discord-awards.js`: commissioner-confirmed official winners and historical records. Preserve as the award authority. |
| Isolated simulations | `simulation-storage.js`, `simulation-engine.js`, `simulation-box-score.js`, `simulation-corrections.js`, `discord-simulation.js`: separate workspace, snapshots, regular season/postseason, trades/FA/development, pause/resume/reset, output receipts. |
| Website | `src/web.js`, `web/app.js`, existing HTML/CSS: authenticated administration, player/team pages, portraits, standings/stats/schedules, OCR review, postseason and audit-log endpoints. |
| Discord setup | `discord-channels.js`: persistent channel IDs, ordered channels, permissions and topics. Existing Staff, announcements and available-teams pins; time-off last. |

## PARTIALLY IMPLEMENTED — extend existing code

- [ ] Lifecycle: phase constants exist; championship ends in OFFSEASON. No ordered commissioner-confirmed offseason subphase workflow or idempotent season rollover.
- [ ] Data integrity: existing journals support finite known files; new offseason, progression, rankings/news records must participate in the same recoverable transaction mechanism rather than parallel writers.
- [ ] Retirement: active player/roster removal exists, but no retirement evidence/review or persistent retired-player transaction exclusion.
- [ ] Draft order: existing draft picks, ownership/protections and mock lottery exist; no authoritative NBA 2K screenshot import. An in-game **Mock Draft** screenshot is a projection, not official lottery evidence.
- [ ] Draft prospects: four classes, portraits and prospect IDs exist; no 60-selection import/75-player promotion. No configured first-round rookie scale or second-round contract policy was found.
- [ ] Contracts: salary schedules, options and valuations exist; no Pending Options import or annual rollover.
- [ ] Offseason FA: contract normalization and transactions are reusable. Existing regular-season scoring differs from the requested 35/25/25/15 offseason model; keep regular-season rules intact.
- [ ] Rosters: memberships/imports/waivers exist. Preseason validation only blocks empty/invalid rosters; suspicious sizes are warnings. Exact 15-player cutdowns, temporary offseason maximum 20, 85+ cutdown protection and reminder windows are missing.
- [ ] Progression: upgrades and player editing exist; these are not a 30-team NBA 2K progression import. Need evidence, coverage, atomic final confirmation and historical team-at-time records.
- [ ] Percentage leaders: stats preserve makes/attempts and profiles show percentages. Discord currently requires only one attempt; website allows percentage sorting without requested qualification. Need one shared eligibility rule and boundary tests.
- [ ] Team Needs: `mock-engine.js` already derives position needs from OVR, age/depth and contracts, used in mock selection. Minimum two / maximum four yellow highlights and consistent team-page presentation require work.
- [ ] Weekly mock: existing command is first-round only and includes explanatory evaluation. Need the requested simple Round 1/Round 2 toggle while preserving Live Mock UI and controls.
- [ ] Test Mode: extends through championship, not retirements/draft/options/cutdown/progression/news/rankings/streams/next season.
- [ ] Historical views: schedules/postseason/awards persist; full season snapshots and cross-season career/progression/ranking/news hubs need extension.
- [ ] OCR inputs: JPG/PNG/WebP game evidence supported; HEIC not accepted. Supplied phone photos require portable decoding and screen-region extraction. Existing box-score crop logic is unsuitable for progression/options/draft tables.

## MISSING — build on the integrations above

- [ ] Retirement import/review and confirmation.
- [ ] Official lottery/order import, reconciliation and confirmed authoritative order.
- [ ] NBA Draft result import with 60 selections, 15 undrafted players and configured rookie contracts.
- [ ] Pending Options import and confirmed contract/membership outcomes.
- [ ] Exclusive re-signing plus three offseason FA stages, priorities, limits, reminders, approval, transaction-report verification.
- [ ] Commissioner cutdown window, extensions/reminders, exact rosters and protected waivers.
- [ ] Progression batch OCR/review, 30-team coverage, final roster verification, immutable player history, combined announcement and website hub.
- [ ] Power Rankings calculations/snapshots/pin/website hub and newly-entering Top 10 notifications.
- [ ] News scenario catalog/detection, verified article generation, Staff review/edit/regenerate, scheduling/deduplication, corrections and website live feeds/search/archive.
- [ ] Streamlink: no button, URL field, announcement service or website stream feature was found anywhere in current `src`/`web`. Preserve the game submission/thread workflow and add stream controls there; do not create a separate game workflow.
- [ ] Full-lifecycle isolated end-to-end test including rollover and historical preservation.

## Decisions requiring user input

1. First-round rookie scale and second-round contract terms are absent from the current repository. Do not invent them.
2. Resolved by the user: do not assign or track home/away. Every weekly game thread states that the home team is required to stream and offers the Streamlink button. Either participating coach can submit the link; the coaches determine home in-game.
3. Existing generator gives 14 games + one bye per team over 15 weeks, not one bye every week. Preserve the generator pending clarification.

## Photo evidence inspected

All 28 supplied paths are HEIC phone photographs. Representative images decoded and inspected: IMG_1279 (in-game Mock Draft), IMG_1293 (Pending Options), IMG_1306 (Player Progression). These include perspective/room background, abbreviated player names, small +/- OVR markers, and two distinct team labels. IMG_1306 selects Washington Wizards in the table while the upper-right franchise header says Cleveland Cavaliers. Imports must use the selected table team, preserve originals, and present uncertain mappings for review. Do not treat Mock Draft screenshots as authoritative drafted selections.

## Staged implementation

1. Complete this audit; preserve current working changes.
2. Extend existing JSON journal for safe lifecycle records, ordered subphase transitions, rollback snapshots and season archives.
3. Implement offseason evidence/review/confirmation services using existing roster, contracts, picks, locks and permissions. Block unresolved rookie/home/schedule rules rather than inventing them.
4. Progression import and historical results, then shared statistics qualification.
5. Rankings, existing Team Needs/mocks, then News and Streamlink.
6. Extend the one simulation engine and run complete isolated lifecycle/regression/deployment checks.

The latest attachment makes Sportsbook part of the requested implementation. It remains unimplemented: fictional career balances, odds/markets, private verified-coach betting, own-team restrictions, previews/confirmation, Streamlink betting locks, settlement/correction ledgers, weekly specials, website integration and isolated Test Mode coverage are still required. The previous attachment's future-only scope is superseded.

## Implementation progress in this pass

- Added `offseason-state.js` and `offseason-service.js`: ordered steps, commissioner review/confirmation, persisted confirmation tokens, cancellation/expiry/source-change checks, backups and immutable season archives including game records. The existing transaction journal is reused and validates paths/schemas before replay.
- Added guarded, idempotent rollover through the existing reset journal: league/guild binding move together, roster memberships carry forward without erasing history, age/experience advance once, incoming rookies keep zero experience, historical contracts remain stored while the valuation/display season advances. Rollover checks 30 teams, exact 15-player rosters, next-year salaries, accepted option decisions, completed offseason preparation and unresolved transactions. Schedule policy must be explicitly confirmed; no assumption was applied to the pending question.
- Added the website offseason checklist and Discord Staff-report control. Critical advancement remains commissioner-only.
- Added `retirement-import-service.js` and website retirement review: original JPG/PNG preservation, SHA-256 duplicates/integrity, bounded shared OCR, candidate suggestions, explicit player selection, complete-image review, persisted confirmation, atomic retirement/membership changes and saved-photo OCR retries after restart. Retirement never publishes automatic News. Retired players remain stored and are excluded from FA/trade eligibility.
- Added `stat-qualification.js`: one shared percentage-leader rule, per-category eligibility metadata, Discord filtering and website percentage-sort filtering. Other leaderboard categories and raw profile percentages remain unchanged.
- Corrected the website playoff handoff description from eight to ten seeds per conference.

This is **partial implementation of the complete prompt**, not a readiness claim or a completed offseason workflow. Official lottery, draft promotion/contracts, options import, staged offseason FA, cutdowns, progression, rankings, News, Streamlink, shared Needs/mock changes and full-lifecycle Test Mode integration still require implementation. Future offseason steps intentionally block until their verified services record completion. These changes have not been deployed.

### Latest user corrections and remaining work

- Weekly matchup embeds now state “The home team is required to stream” and offer Streamlink before or after setting the game date. Participating coaches can submit/update an HTTP/HTTPS URL in a modal; the URL and submission history persist against the game ID and the matchup embed updates immediately. Ownership/thread/season/finalization authorization is rechecked on submission. No home/away designation is stored. Existing activity-card refreshes pick up the new controls after deployment.
- Stream announcements in the dedicated channel, website game/stream pages and Sportsbook locks are not yet implemented.
- NBA rookie-scale research is now implemented in `rookie-contracts.js`, using the official 2024–25 NBA CBA first-round scale and second-round exception schedules. Later-year league amounts are explicitly derived from a commissioner-entered NBA 2K salary cap; they are not presented as published future NBA tables. Draft import records first-round options and exact reviewed second-round terms.
- Streaming/thread/URL tests: 19 passing. Game-activity and retirement regression: 19 passing. These focused results do not replace a full end-to-end lifecycle check or imply deployment.

### Full supplied-photo review

All 28 originals were decoded into temporary previews without changing the originals. The set contains:

- IMG_1279–IMG_1286: in-game **Mock Draft** projections; these must not become authoritative lottery/draft results.
- IMG_1287–IMG_1292: **Draft Summary** pages spanning the two rounds; unlike Mock Draft, these are drafted-selection evidence.
- IMG_1293–IMG_1296: **Pending Options** pages.
- IMG_1297–IMG_1300: **Transaction Report / Signing** pages with dates and contract summaries.
- IMG_1301–IMG_1304 and IMG_1306–IMG_1307: **Player Progression** pages for Cleveland, Philadelphia and Washington, including scrolled roster portions.

No retirement-screen or official-lottery-screen example was found in this set. Phone photos include background and perspective; the selected/table team and upper-right controller franchise can differ. The new retirement upload accepts JPG/PNG (including exported phone photos), not HEIC directly. HEIC previews were decoded with macOS `sips` for this audit; portable server-side HEIC support and calibrated OCR for the other table types remain unfinished.

### Validation

The final full check completed with **528 tests passing, zero failures**. Subsequent focused tests cover the added rollover, retirement OCR retry, confirmation cancellation and browser shooting filters. Focused lifecycle/reset/retirement/API regression after the final confirmation guards: **14 passing**. Browser offseason/retirement flow checks: **2 passing**. Browser checks verify explicit/cancellable offseason confirmation and independent qualified-percentage sorting. No live league data was imported or advanced during testing.


## Latest implementation status (supersedes the initial missing/partial lists)

- **Player of the Week:** automatic East/West awards in the existing week-finalization transaction and awards store. Uses verified single-game statistics, efficiency/all-around production, modest win/margin context and deterministic tiebreakers. Permanent weekly Discord posts have persisted delivery receipts and restart reconciliation. Public website current/history filters, game links, portraits, player-profile career achievements and isolated simulation output are connected. Actual rollover preservation is tested.
- **Official lottery / draft / options / progression imports:** commissioner-only original-photo storage and OCR retries, typed player/team review tables, separate source-checked confirmation, protected original access, permanent IDs and atomic receipts. Lottery reconciles 30 assets; Draft promotes 60 drafted and 15 undrafted players; Options preserves contract history; Progression verifies exactly 450 players on 30 teams, stores OVR history and also provides the final roster verification.
- **Progression reporting:** website history, season/team/player filters, biggest risers/fallers and team averages. One combined Discord announcement includes top 10 increases/decreases and a composite of existing portraits/team fallbacks. Delivery reconciliation prevents reposting after an interrupted save.
- **Cutdowns:** 24-hour commissioner window, extensions, coach MyTeam controls, staff website review, explicit waivers, 6-hour/1-hour reminders, exact 15-player completion checks and non-bypassable 85+ protection. Contract and membership histories survive releases. Trade-window completion also blocks unresolved transactions and rosters over the temporary 20-player limit.
- **Offseason free agency:** separate scoring and staged state within the existing FA store. Exclusive re-signing plus three open stages, pause/extend/resume, private coach role-verified offers, 1–5 priorities, five active offers, three signings/stage and nine total. Explicit staff preview/confirmation, individual rejection reasons, contract/membership history and temporary 20-player guards. Existing regular-season scoring remains intact. Commissioner Transaction Report photos and exact signing/contract reconciliation are required for the completion receipt. Private outbid alerts, stage reminders and public approved-signing announcements use persisted delivery receipts. Staff website and existing Discord FA/MyTeam entry points are connected.
- **Power Rankings:** deterministic 40/25/20/15 regular-season formula, independent opponent rating, top-three/next-five/remaining-seven roster weights, last-five recent form and separate preseason progression scoring. Persisted weekly/season snapshots, one Top 10 pin, new-entrant-only coach notifications, website history/breakdown/movement and isolated simulation output. Preseason rankings are stored against the incoming season.
- **Team Needs / mocks:** shared 2–4 targeted positions on the website and Live Mock board. Weekly mock now supports deterministic Round 1/Round 2 views, all 60 selections without duplicates and second-round asset ownership. Live Mock retains its original 30-pick flow. Confirmed NBA 2K first-round order is reused. Offseason roster events enqueue existing simulation refreshes.
- **Regular-season safeguards:** exact 15-player preseason gate, non-bypassable 85+ waiver protection across regular/offseason/admin releases and the generic home-team streaming reminder plus participant-owned Streamlink controls.

### Current additions and validation

- **News:** 600 measured performance scenarios; verified game, completed trade, approved signing, championship and progression sources; Staff approval/edit/reject/regenerate/correction; 3-hour spacing and four routine articles per day; explicit breaking approval; permanent Discord posts with correction edits and reaction counts; website featured/latest/trending/full article/search/archive filters. Multi-game trend review runs at four-hour intervals and published weeks support a deeper weekly report. Audience reactions affect engagement only. Relevant coaches are mentioned on approved transaction/breaking stories, with the Coach role for championship news.
- **Streams:** generic home-team reminder and participant Streamlink button, first-link betting lock saved before network delivery, immutable verified preview facts, permanent announcement/update recovery, dedicated channel, website live/game pages and Sportsbook links. No home/away field was introduced.
- **Sportsbook:** fictional career $300 wallets with reconciled integer-cent ledgers, current Discord ownership/role checks, private coach website sessions issued from MyTeam, game lines, supported totals/props, weekly specials, exact combined parlay odds/payouts, previews and separate confirmation, own-team bans, automatic settlement, pushes/voids and recorded corrections. Public leaderboard exposes aggregate records; private wagers require authentication. Staff can inspect frozen corrected payouts and the ledger. Already-spent corrected payouts remain frozen pending the policy decision below.
- **Phone photos:** portable HEIC decoding in an isolated bounded worker, plus JPG/PNG normalization. Original bytes and hashes stay preserved. Perspective-aware row suggestions support draft/options/progression tables, Transaction Reports show total contract value without inventing annual salary terms, and lottery owner labels do not imply an original franchise. The website adds only matched fields to a review, preserves edits, leaves conflicts blank and invalidates visible confirmations. Unreadable fields still require manual verification.
- **Test Mode:** the existing engine now includes News, stream previews/locks and isolated Sportsbook wagers/settlement. Added **Offseason + next season** and **Complete season + offseason** choices, using the production retirement/lottery/draft/options/FA/cutdown/progression/rollover services and explicit TEST MODE synthetic evidence. Shared mock selection protects talent/uses team fit; next-season Team Needs and Power Rankings are recalculated. Stage checkpoints and pause/resume/restoration preserve the correct active season. Missing fixture contracts receive labeled simulation-only assumptions; actual stored contracts are preserved.
- **Rollover fixes:** a current legacy schedule no longer makes every future season appear to exist; a new schedule starts without conflicting week-one status. Tests now include starting a week after rollover and restoring the pre-rollover draft checkpoint.
- **Historical eligibility:** News, weekly awards and player props use the team a player represented at game time, including recorded trade ownership history.

Final combined `npm run check`: **609 tests passed, zero failures**, including TypeScript/syntax checks, browser flows, a complete regular season/playoffs/offseason/rollover, career-wallet and historical-News preservation. Seven additional focused simulation-control/lifecycle checks passed after the final delivery-key/summary refinements. Production dependency audit: **zero vulnerabilities**. The actual supplied HEIC photo passed upload → protected original read → retirement confirmation in temporary storage; original photo bytes were unchanged and no live data was touched. `git diff --check` passed.

### Remaining release checks / decision

- Select the policy for a corrected fictional payout that has already been spent: track a shortfall repaid by future winnings, or keep the wallet frozen for an explicit Staff resolution. No negative wallet, bailout or unapproved debt policy was added.
- The supplied photos contain no official lottery or retirement-screen example. Lottery owner/original-franchise matching stays reviewable; unreadable progression changes cannot be guessed. Manual review is the supported fallback.
- Complete final regression and production deployment verification of new channels, pins, private coach sign-in, stream announcements and News delivery. Unit/browser tests do not substitute for observing Discord permissions and Railway behavior.

No live league data was imported or advanced. The current changes have **not been deployed**. This document does not claim 100% readiness.

NBA references: [official NBA CBA 101](https://cms.nba.com/wp-content/uploads/sites/4/2024/11/2024-25-CBA-101.pdf), [NBPA CBA](https://nbpa.com/cba). League contract limits currently use four years for open signings and up to five for exclusive re-signing; they are a league implementation policy, not a claim that every real NBA player has Bird eligibility.


### How to exercise the new practice flow

1. In the pinned Staff **Test Mode** panel, choose **Run Simulation**.
2. Select **Complete season + offseason**, **Keep current rosters**, and **Summary only** for the first complete run. This creates a separate workspace and uses labeled synthetic evidence; it does not import your pictures into the live league.
3. Inspect the completion result, season archive, News, Sportsbook history and stage checkpoints. For more detailed Discord output, choose **Every game and event** on a fresh run.
4. Pause during the run, then Resume. In the offseason it stops between completed stages. Restore the **Season 1 DRAFT** checkpoint to verify that season ID and roster memberships return to the pre-rollover state.
5. After rollover, run **1 week** to verify that the new season starts. Restore **Starting state** when finished.
6. If an actual roster/pick/contract conflict prevents an offseason stage, resolve that conflict in the isolated copy or restore a checkpoint. The runner does not bypass protected-player or roster-limit guards.

Production smoke testing still needs Discord/Railway deployment. Use a disposable live test matchup to check coach-only Streamlink controls, immediate market locking, one announcement, private coach website login and Staff-approved News delivery.
