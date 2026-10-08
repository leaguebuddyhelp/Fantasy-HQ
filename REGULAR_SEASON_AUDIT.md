> Historical audit: subsequent implementation repairs and current verification are documented in [READINESS-REPAIRS.md](READINESS-REPAIRS.md). The findings and 64% assessment below describe the earlier audited code.

# LEAGUEbuddy — Regular Season Repository Audit

Audit date: October 7, 2026. Scope: the current working tree, including existing uncommitted and untracked application files. This is an audit of the local repository, not certification of the currently deployed Railway version.

## 1. Executive Summary

**Regular Season readiness: 64%. A complete live 15-week season is not ready.** Most ordinary game, roster, transaction and statistics paths have substantial implementation and automated coverage. The remaining problems include data integrity, public website availability, coach replacement and the end of the season; these are operational requirements, not presentation improvements.

The 13-system matrix contains **2 COMPLETE, 8 PARTIAL, 3 BROKEN, 0 MISSING and 0 UNVERIFIED systems**. Individual missing and externally unverified capabilities are identified below; a system with implemented regular-season behavior and a missing playoff handoff is PARTIAL rather than wholly MISSING. There is **1 P0 blocker and 6 P1 issues**. Counts refer to unique findings, not the number of affected systems.

`npm run check` passed: **432 tests, 432 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo**. This includes syntax checks, TypeScript checking, local browser tests and actual offline OCR against saved images. Separately, all **22 slash-command definitions** serialized successfully, were unique and had top-level handlers. Passing tests do not establish correctness of every full-season workflow: isolated audit probes reproduced failures that the existing suite does not cover.

Key reproduced failures:

- A corrupt draft-pick file loads as an empty list; submitting an FA offer then permanently replaces that file with valid `[]` while returning success.
- A malformed unauthenticated draft-image URL throws outside the HTTP handler and terminates an isolated server process. The production entry point runs the website and bot together.
- Approved trades, FA offers and pending waivers can execute using a departed coach's authorization after team reassignment.
- A failed admin player move leaves the player record changed and roster membership unchanged, without a recovery journal.
- Week 15 completion keeps `REGULAR_SEASON`; new FA offers and waivers remain accepted afterward.
- Discord `/stats`, `/teamstats` and MyTeam use a different publication scope from the website and standings pins.

No fixes, command registration, deployment, live Discord actions or production-data changes were performed. Audit fixtures were temporary and cleaned up. This report is the only application-workspace file created by this audit. Existing source changes were preserved. Live Discord permissions, actual delivered DMs, Railway volume/backups and a real full-season rehearsal remain **NOT VERIFIED**.

### Actual repository architecture

| Area | Actual implementation and responsibility |
|---|---|
| Process / bot | `src/index.js`: Discord client, command/component dispatch, shared services, website startup, gateway events and timer recovery. `src/config.js`: environment configuration. `deploy-commands.js`: guild command definitions and REST deployment. |
| Website | `src/web.js`: Node HTTP routes, admin-key authorization, static files, league APIs and runtime hooks into the connected bot. `web/index.html`, `web/app.js`, `web/styles.css`: existing site. `web/box-score-review.html` / `.js` / `.css`: game review. |
| Canonical storage | `src/fantasyhq/repository.js`: guild bindings and league JSON; transaction journals and replay. League files include teams, owners, players, memberships, picks, trades, upgrades, FA state, settings, schedule and audit log. `src/fantasyhq/game-submissions.js`: permanent `game-history/<gameId>/record.json` and original media. |
| Setup / ownership | `setup-service.js`, `setup-validator.js`, `preseason-validator.js`, `bootstrap.js`, `discord-setup.js`, `discord-admin.js`, `delete-league.js`, `discord-delete-league.js`; `role-ownership.js`, `coach-identity.js`, `member-snapshot.js`, `discord-roles.js`, `discord-permissions.js`. These files are under `src/fantasyhq/`. |
| Channels / pins | `src/fantasyhq/discord-channels.js`, `discord-league-feeds.js`, `discord-weekly-dashboard.js`; `src/shared/discord-pins.js`. Channel repair includes 18 configured channels, restricted Staff/Committee channels and persistent system messages. |
| Schedule / operations | `src/fantasyhq/schedule-generator.js`, `schedule-validator.js`, `schedule-formatters.js`, `league-service.js`, `game-threads.js`, `game-thread-cleanup.js`, `week-advancement.js`, their `discord-*` handlers, `game-activity.js`, `game-decisions.js`, `weekly-dashboard-service.js`. |
| OCR / final results | `src/fantasyhq/box-score/provider.js`, `tesseract-provider.js`, `normalize.js`, `service.js`, `finalize.js`, `review-service.js`, `review-route.js`, `learning.js`; `discord-game-submissions.js`, `discord-game-approvals.js`, `official-game.js`. |
| Statistics | `src/fantasyhq/standings-service.js`, `player-stats-service.js`, `team-stats-service.js`, `team-service.js`, associated Discord handlers and website routes. Aggregates derive from official archived game records rather than a separate manually maintained standings database. |
| Transactions | `src/fantasyhq/trade-service.js`, `discord-trades.js`, `player-upgrades-service.js`, `discord-player-upgrades.js`, `free-agency-service.js`, `discord-free-agency.js`, `offer-score.js`, `transaction-locks.js`, `asset-valuation.js`, `player-service.js`, `roster-service.js`. |
| Contracts / reference imports | `src/shared/player-contract.js`; `src/2kratings/repository.js`, `discord-ratings.js`; `src/scrapers/2kratings/` including contract scraping. Reference roster snapshots under `data/2kratings/` are import sources, not the mutable league roster. |
| Additional regular-season surfaces | Trade block, activity check, scouting and mocks have separate services/handlers and tests. Mock/scouting data is not an official game/statistics source. A working mock playoff-team configuration does not supply a league playoff-transition workflow. |
| Tests / deployment | Node `test/*.test.js`, reusable isolated fixtures, saved game/contract images, Playwright tests, `scripts/`; `package.json`, `tsconfig.json`, `Dockerfile`, `.dockerignore`. No lint or build script is defined. |

Paths abbreviated in tables above retain the `src/fantasyhq/` prefix unless another directory is shown.

At startup and during operation, `src/index.js:810` onward restores mocks, FA, trades, OCR learning, publication state and upgrades. FA sweeps run every 15 seconds; league feeds, activity, trade blocks, weekly dashboards and upgrade sweeps run every minute; periodic ownership synchronization runs every five minutes, supplemented by gateway events and actor refresh. These are persisted-state reconciliation jobs, not a durable general-purpose job queue.

## 2. Feature Completion Matrix

Status meanings: COMPLETE = implemented, integrated and supported by passing relevant tests; PARTIAL = meaningful implementation with missing requirements/integration; BROKEN = a reproduced failure in an implemented major path; MISSING = no meaningful implementation; UNVERIFIED = implementation cannot be sufficiently validated. External checks are explicitly UNVERIFIED even where a system's local behavior is tested.

| System | Status | Evidence | Missing/Broken | Priority |
|---|---|---|---|---|
| League Setup | COMPLETE | Setup, preseason, deletion, role ownership, channel repair, permissions and pin tests pass. Creation/import/activation, guild binding and protected admin endpoints exist. | Live role hierarchy, deployed website configuration and backup restoration NOT VERIFIED. Admin mutation reliability is separately A004. | P1 dependency |
| Schedule | COMPLETE | `schedule-generator.js`, validator, `fantasyhq-schedule.test.js`, `regular-season-weeks.test.js`, `week-advancement.test.js`: 15 conference-only weeks, 14 games and 2 byes per week, 14 games/one bye per team, initialized/stable IDs, guarded advancement and replay. | Final playoff handoff belongs to Season Transitions. Configurable deadline text disagrees with the fixed clock, A019. | P2 |
| Game Threads | PARTIAL | `game-threads.test.js`, cleanup tests: private threads, coach/Staff membership, 48-hour persisted deadline, retry, uncertain-create protection and archives retained after cleanup. | Old members are not removed on reassignment; thread reconciliation is not part of owner-change callback. Ambiguous interrupted creation needs manual linking. A010. | P2 |
| Game Submissions | PARTIAL | Upload authorization/deduplication; real-image OCR; normalization, uncertainty review, correction, finalization, approval cards and game archives pass relevant tests. | No supported final-result reversal; no structured Staff reject endpoint in the review service; decisions alone do not finalize forfeits. Clean OCR can finalize without an explicit Staff click. A005/A006. | P1 |
| Standings | PARTIAL | Official-only W/L/GP/PCT/PF/PA/DIFF, conference ranking, duplicate exclusion and publication-at-advance are tested on website and Discord. | Final ties use team name/ID after PCT and wins; no sporting tiebreaker or confirmed playoff-seeding handoff. A003. | P1 |
| Player Stats | PARTIAL | Totals, game logs, PPG/RPG/APG/SPG/BPG/MPG/TOV, weighted FG/3P/FT percentages, DNP handling, leaderboards and historical teams tested. | Supported post-final correction/reversal absent; Discord command sees active-week games while website/pins use published games. A005/A018. | P1/P2 |
| Team Stats | PARTIAL | PF/PA, box totals, per-game averages, shooting percentages, game logs, leaderboards and malformed/duplicate-row checks tested. | Discord command scope disagrees with published website scope; no controlled final-result correction workflow. A018/A005. | P2 |
| Trades | BROKEN | Multi-team/player/pick/multi-asset proposals, snapshots, coach decisions, Committee majority, proof, exact 15-player rosters, five-trade limit, valuation, journals and idempotent completion tested. | Final approval does not invalidate old-coach approvals after replacement; no explicit submitted-trade cancellation. A002/A015. | P1 |
| Player Upgrades | PARTIAL | Eight normal categories; total 1–5 points, +1–3 per attribute; three Specials; per-player/team/season limits; tenure/new-user rules; request/Staff flow; OVR/build/strength weight/value/history/reset/phase tests pass. | Human-vs-CPU Staff submissions do not advance qualifying games; lost notification has no retry; completed regular-season status is not an eligibility guard. A008/A009/A003. | P1/P2 |
| Free Agency | BROKEN | Primary-position/OVR browser, actual contract-image OCR, private offers, immutable hour, scoring/improvements/withdrawal, two targets/five signings, cuts/fallback, journal recovery and public/private payload tests pass. | Departed-coach offer executes; completed season allows new windows; failed DM is treated as delivered. A002/A003/A009. | P1 |
| Waivers | BROKEN | MyTeam selection → private Staff proof → approval → membership end/contract clear → FA pool/audit/announcement, transaction locks and repeated decision tests pass. | Departed-coach request still releases player; completed regular season still accepts requests. A002/A003. | P1 |
| MyTeam | PARTIAL | `discord-preseason.js:70`, display/usability/ownership tests: current roster, contracts/payroll, player cards, picks, FA counters, My Week and Waive Player controls. | Record/player-stat publication scope differs from website; persistent actions revalidate, but an already posted roster embed does not auto-refresh after every transaction. A018. | P2 |
| Season Transitions | PARTIAL | SETUP → PRESEASON → REGULAR_SEASON implemented/tested; Week 15 can be closed with persisted archives/publication. | Regular → PLAYOFFS, final seeding and an integrated pending-operation decision are MISSING. A003. Test-only phase switching is not a production transition. | P1 |

### Detailed capability checks

- **Setup:** create/delete, source imports, team assignment, current-owner inference, Staff controls, channel repair, persistent pins and JSON configuration are COMPLETE at the local tested layer. Deletion has an actor-bound short-lived confirmation, checks league ownership of archives and preserves shared reference assets/Discord infrastructure; it is not a backup. External Discord configuration is UNVERIFIED. Bulk/import/admin writes have the reliability limitation in A004.
- **Weekly operations:** conference-only schedule, byes, normal/forced advancement, completion checks, deadline persistence, cleanup confirmation and archived media survival are COMPLETE. Normal advancement rejects unresolved games. Forced advancement records unresolved identities and invents no wins or stats. Thread permission replacement is PARTIAL. Scheduled automatic thread deletion at the deadline is not implemented; cleanup is explicit Staff work.
- **Games:** JPG/PNG/WebP originals, bounded Discord downloads, magic-byte checks, two sides, retries and deduplication are COMPLETE. Offline OCR supports camera framing/EXIF rotation and saved problematic Wolves/Rockets, Heat/Pistons and Cavaliers/Heat images. Arbitrary glare/perspective/new layouts remain UNVERIFIED. Pre-final corrections/approval are COMPLETE; a standalone Staff rejection state/action is MISSING in `review-service.js`/`review-route.js`. Clean validated TEAM_SIDES/STAFF_BOTH attempts automatically finalize (`box-score/service.js:59`); “approved” does not always mean a Staff member clicked approval. Forfeit/Fair Sim decisions are COMPLETE as agreements, PARTIAL as official-result workflows.
- **Standings and statistics:** official record filtering, scope checks and derived aggregates are COMPLETE. Zero-attempt shooting percentages are null, not fabricated. Player/team totals retain the historical game team after later moves. Duplicate official matchups are excluded with warnings rather than choosing an arbitrary winner. Alphabetical ties are deterministic but PARTIAL as sporting tiebreakers. Post-final correction/reversal and final seeding are MISSING. Publication consistency is BROKEN for command/MyTeam consumers (A018).
- **Trades:** proposal, counter/version reset, GM deny, Committee approve/deny, proof approve/reject, player/pick movement, future-pick protections, contracts/value snapshots and transaction history are COMPLETE in existing tests. New proposals stop after Week 9; previously submitted proposals can finish later. GM/proof actor ownership checks exist; final historical consent revalidation is BROKEN. Cancellation/withdrawal of a submitted proposal is MISSING. Pending proof review has no automated expiry, so Staff resolution is essential.
- **Upgrades:** every fourth eligible coach-submitted game earns a balance; repeated reconciliation is idempotent. Tenure changes expire requests/balances appropriately and grant the new-user entitlement once. Eight normal categories and three Specials, one Special/team/season, two completed upgrades/player/season, category repeat restrictions, Staff request ledger, OVR/build modes and Strength Training +8 lb are COMPLETE in tests. The requested attribute allocations remain request/history instructions; approval records resulting OVR/build/weight and does not edit NBA 2K itself. Human-vs-CPU earning integration is PARTIAL. DM retry is MISSING. PLAYOFFS guards work when the persisted phase is actually changed; the production transition that invokes that state is MISSING.
- **FA:** position-only browsing/OVR order, original proof storage, three supplied contract-image layouts, Staff correction/approval/rejection, Offer Score, private bidding, immutable deadline, improvements, withdrawals, target/signing counters, conditional release and persistent winner fallback are COMPLETE in isolated tests. MINIMUM is deliberately not converted into an invented salary: Staff must enter the numeric value. Live file-upload modal delivery and DMs are UNVERIFIED. Coach replacement and failed notification handling are BROKEN. Once explicitly in PLAYOFFS, new windows/improvements are blocked, while an existing regular-season window may accept on-time new bidders and finish; pending waivers may finish. This is the current tested policy, not a blanket transaction freeze.
- **Waivers/MyTeam:** roster selection, lock checks, Staff proof controls, contract removal with audit preservation, FA availability and announcements are COMPLETE for normal ownership. Replacement safety is BROKEN. Website team dashboards omit private contract-offer details; Discord/private dashboard can include the acting coach's own pending operations. An old posted embed is a snapshot; reopening a command fetches current data.

## 3. Critical Blockers

### A001 — P0 — Corrupt canonical JSON is silently converted to empty state and overwritten

**Affected:** picks, players, rosters, trades, upgrade/FA state and audit history. **Locations:** `src/fantasyhq/repository.js:12`, `:118`, `:488`, `:512`; `src/fantasyhq/free-agency-service.js:21`.

**Evidence/reproduction:** in an isolated FA fixture, save one draft pick, truncate `draft-picks.json` into invalid JSON, call `loadDraftPicks`, then submit a valid FA offer. The loader returned `[]`; the offer returned `PENDING_REVIEW`; the file afterward was exactly `[]\n`. The FA journal includes all canonical transaction files, even for offer submission.

**Expected:** corrupt/unreadable required storage fails closed and leaves recoverable bytes untouched, with an actionable error. **Actual:** the broad catch conflates missing files, parse errors and read errors with a legitimate empty collection. A successful unrelated operation destroys the remaining evidence/state. **Recommended fix:** distinguish first-use ENOENT from invalid existing files; validate required schemas; quarantine/backup corrupt files; refuse transactions until integrity is restored. Cover corrupt picks, players, memberships, FA/upgrades and audit files in fault tests before enabling further live operations.

### A007 — P1 — Unauthenticated malformed asset URL terminates the website process

**Affected:** website availability and the co-hosted bot. **Locations:** `src/web.js:822`, `:837`; shared startup in `src/index.js`.

**Evidence/reproduction:** an isolated `http.createServer(requestHandler)` received `GET /draft-assets/%` on localhost. The process exited **1** with `URIError: URI malformed` at `web.js:822`. There is no outer request-handler exception boundary; the server's `error` event listener does not catch a thrown request callback.

**Expected:** malformed public input gets a controlled 400/404 and leaves the process alive. **Actual:** public path decoding throws synchronously; hosting website/bot together increases the impact. Railway's edge handling of this exact raw path is NOT VERIFIED, but the origin handler failure is reproduced. **Recommended fix:** validate/catch path decoding, add a request-level exception boundary and regression tests through a real isolated HTTP server. Do not rely on process restart as input validation.

### A002 — P1 — Coach replacement does not invalidate transaction consent

**Affected:** trades, FA signing, waivers, ownership and audit attribution. **Locations:** `src/index.js:60`; `src/fantasyhq/trade-service.js:407`; `free-agency-service.js:85`, `:127`, `:189`.

**Evidence/reproduction:** three isolated probes changed owners after a request/approval:

1. Approved coach-a's FA offer, assigned replacement to team a, expired the hour and ticked: offer became `WON`, credited to coach-a; replacement's team received the player.
2. Requested a waiver as coach-a, replaced coach, approved as Staff: `APPROVED`, team roster fell from 15 to 14.
3. Submitted/accepted/Committee-approved a balanced trade, uploaded proof, replaced initiating coach, approved proof: `COMPLETED`, player moved.

**Expected:** consent is bound to the current coach/tenure; departure invalidates or requires explicit successor reapproval before execution. **Actual:** initial actor checks and later asset ownership checks exist, but prior coach consent is not revalidated at commit. The owner-change hook only reconciles upgrades. **Recommended fix:** central owner/tenure-change handling for all pending operations, plus final current-coach consent checks inside each commit. Define transfer/cancel policy explicitly and test every stage, including pending proof and winner cut.

### A004 — P1 — Admin roster/player writes can leave durable partial transactions

**Affected:** website commissioner edits, imports/bulk edits and canonical player/roster consistency. **Locations:** `src/fantasyhq/player-service.js:106`, `:118`, `:169`, `:186`; `roster-service.js:144`, `:145`, `:267`.

**Evidence/reproduction:** call `updatePlayer` with `{teamId:'b', overall:90}` while forcing the subsequent `saveRosterMemberships` to fail. It threw `Simulated disk failure`; stored player had team b/changed rating while membership still had team a. No transaction journal existed to complete or roll back the move.

**Expected:** all affected player/membership/audit/upgrade-invalidations commit consistently, or failure preserves prior state. **Actual:** each individual JSON file is atomic, but these multi-file admin paths are not journaled. Some roster-only moves use membership as the authoritative read model, yet direct player/export data can diverge. **Recommended fix:** use a common validated roster mutation transaction for website/admin/import paths, including history/audit and locks; add fail-after-each-write tests. Do not infer safety from the trade/FA journals, which these paths bypass.

### A003 — P1 — Week 15 has no supported playoff handoff or complete transaction cutoff

**Affected:** season transitions, final standings/seeding, upgrades, FA and waivers. **Locations:** `src/fantasyhq/week-advancement.js:47`; `league-service.js:100`; `free-agency-service.js:59`, `:184`; `player-upgrades-service.js:398`, `:463`; `standings-service.js:19`; `discord-week.js:6`.

**Evidence/reproduction:** completion code sets `regularSeasonStatus:'COMPLETED'` and keeps phase REGULAR_SEASON/week 15. The confirmation explicitly says playoffs will not start. In isolated completed-season state, new offer returned `PENDING_REVIEW` and new waiver returned `PENDING`. Upgrade eligibility checks phase, not completed status. Repository search found no meaningful production transition coordinating PLAYOFFS, seeds and pending operations. A Staff Test Mode phase toggle exists; it is not that workflow.

**Expected:** after final closeout, a supported commissioner handoff validates/preserves final standings, applies agreed tiebreakers/seeds, decides unresolved games/pending operations and consistently changes eligibility. **Actual:** regular-season weeks close, but the end-of-season operational chain stops. **Recommended fix:** implement one confirmed/journaled transition with explicit pending-transaction policy and independent completed-season eligibility guards. Do not silently cancel legitimate on-time bids or pending proofs without an agreed policy.

### A005 — P1 — A finalized game cannot be corrected or reversed through supported tools

**Affected:** official results, standings, player/team statistics and upgrade progression. **Locations:** `src/fantasyhq/box-score/review-service.js:43`; `review-route.js:6`; `finalize.js` final lock; `player-upgrades-service.js:277`.

**Evidence/reproduction:** invoking the correction service on a FINAL/locked record rejects with `Game is already locked or finalized.` Both correction and approval use the same lock guard. No controlled reopen/reversal workflow was found. Statistics tests that mutate final source records directly prove aggregate recomputation, not a commissioner correction workflow.

**Expected:** authorized, reasoned corrections produce revisions and reconcile publication and dependent awards without double counting. **Actual:** the only supported review is pre-final. Direct JSON/manual service mutation is not a safe operational substitute; upgrade qualifying-game history is additive and would need reconciliation. **Recommended fix:** add an audited final-result revision/reversal operation with immutable before/after versions, dependent-stat/publication policy and upgrade reconciliation. Preserve original screenshots and forbid concurrent approvals of stale revisions.

### A006 — P1 — Forfeit controls cannot close an official game without box scores

**Affected:** deadline closeout, forfeits/simulation and normal week advancement. **Locations:** `src/fantasyhq/game-decisions.js:28`; `official-game.js:2`; `week-advancement.js:20`.

**Evidence/reproduction:** decision handlers save `matchupDecision`/history and explicitly say scores/statistics require validated screenshots. The official-game predicate requires FINAL, a finalized submission and an issue-free extraction. A confirmed forfeit alone therefore remains unresolved for normal advancement. Existing tests intentionally assert decisions preserve scores.

**Expected:** an authorized, agreed forfeit policy can create a legitimate official outcome without fabricating player box scores; Fair Sim can complete from actual validated simulation output. **Actual:** these buttons record agreements, not terminal official outcomes. Staff can force-advance but that leaves no winner/statistical result. **Recommended fix:** define and implement official administrative-result types, their standings/stat/upgrade eligibility and approval/history rules. Keep screenshot-based simulation as a separate supported path. Until then, describe buttons as decision requests and do not claim forfeits are complete.

## 4. Missing Features

| Capability | Status | Impact / linked finding |
|---|---|---|
| Confirmed production Regular → PLAYOFFS transition | MISSING | A003; phase constants and test toggles do not provide a handoff. |
| Sporting tiebreakers / frozen playoff-seeding inputs | MISSING | A003; current fallback is alphabetical, after PCT/wins. Commissioner rules must be specified before implementation. |
| Supported final-result correction / reversal | MISSING | A005; downstream derived recomputation alone is insufficient. |
| Structured game-review rejection state/action | MISSING | Review exposes correct/approve/media, not reject. A failed/review-required extraction can be retried, but no Staff rejection ledger records reason/actor as a decision. |
| Official administrative forfeit result | MISSING | A006; confirmed decision is not an official result. |
| Submitted-trade cancellation/withdrawal | MISSING | A015; deny, counter and expiry exist, but no cancellation service/button. |
| Durable notification retry / Staff resend queue | MISSING | A009; errors do not lose assets, but required notifications can be permanently lost. |
| Repository-level automatic backup/restore workflow | MISSING | A013; journals recover committed transactions, not deleted/corrupt entire files. Hosting backups are UNVERIFIED. |
| Cross-process writer coordination for regular-season JSON | MISSING | A012; regular-season locks are in-memory. This is a scaling/deployment constraint, not a reproduced failure of the supported single process. |

## 5. Broken Integrations

### Seven complete workflow traces

| Workflow | Actual chain and integration points | Status / break |
|---|---|---|
| 1. Game completion | `discord-game-submissions` → `game-submissions` stored originals → `box-score/service` provider/normalize → automatic clean finalization **or** review-route/service correction+approval → `finalize` single game record → `official-game` → standings/player/team derived stats → `index.js:61` finalization callback → upgrade reconciliation and Discord approval notice → advancement publication/pin refresh. | PARTIAL. Ordinary finalization is tested; Staff approval is conditional, not mandatory on every result. Administrative forfeit and final correction missing. STAFF_BOTH human-vs-CPU games stop at upgrade progression; Discord stats publication scope diverges. |
| 2. Player trade | Discord draft/selectors → `trade-service` preview/snapshot → current-owner GM decisions → eligible Committee majority → private proof → Staff review → final asset/roster validation → transaction journal moves player/membership/picks/trade/audit → upgrade invalidation callback → website current reads; Discord post/DM workflow. | BROKEN on coach replacement. Assets and roster counts revalidate, but historic consent does not. Ordinary completion/recovery/idempotency tested. Existing MyTeam embeds need reopening. |
| 3. Player upgrade | Official qualifying game → tenure reconciliation/every-four balance → private request/category/allocations → request ledger → Staff reject or OVR/build mode approval → player+upgrade journal → weight/rating/build/history → calculated Trade Value → current profile/roster reads. | PARTIAL. Tested normal path works; STAFF_BOTH excludes human-vs-CPU progress, no durable award-DM retry, completed-season guard absent. NBA 2K attribute application remains manual. |
| 4. FA signing | Private upload modal → original file/OCR → coach confirmation → service normalization → private Staff proof correction/decision → approved Offer Score → immutable deadline tick → ranking/fallback → cut/roster validation → common transaction journal writes membership/player contract/counter/audit → public announcement/private result. | BROKEN on departed coach and failed DM receipt; ordinary deadlines, competing bidders and interrupted commits tested. |
| 5. Waiver | MyTeam `fa:waive` → coach identity/current roster/unlocked selection → confirmation → persistent request → Staff proof approve/reject → shared lock/season check → inactive membership/contract removal → FA browser/audit → public announcement. | BROKEN on coach replacement. Normal lock/idempotency/contract clearing tested. |
| 6. Coach replacement | Discord team role change/assignment → complete member snapshot → `role-ownership` owners/team records/Coach role → `index.js:60` upgrade tenure callback → pending upgrade expiry/new-user entitlement; subsequent actor refresh checks role+owner agreement. | PARTIAL/BROKEN integration. Upgrade branch works; pending trade/FA/waiver consent not invalidated, and game thread repair adds replacement without removing old member. |
| 7. Season ending | Week 15 official completion checks → confirmation → journaled schedule completion/publication and league completed flag → feed/weekly refresh; archives retained. | PARTIAL. Stops before final seeding, coordinated pending-operation policy and PLAYOFFS phase transition. New FA/waiver eligibility remains open. |

### A018 — P2 — Published statistics differ between Discord consumers and website

**Locations:** `src/index.js:117`, `:123`; `src/fantasyhq/discord-preseason.js:12`; `src/web.js:27`; `src/fantasyhq/discord-standings.js:11`; `discord-league-feeds.js:24`.

Website statistics and standings pins use `publishedOnly:true`. Discord `/stats`, `/teamstats` and MyTeam construct services with the default live scope. An isolated fixture containing an official active-week game produced **Discord-default player GP 1 vs website-published GP 0**, and **MyTeam-default eligible games 3 vs website-published games 2**. This violates the earlier requested weekly publication behavior and cross-surface consistency.

Recommendation: distinguish operational live totals from public published totals explicitly, wire each consumer to the correct shared scope and test the actual entry-point wiring. Existing publication tests validate the service option, not all callers.

### A008 — P2 — Human-vs-CPU games submitted by Staff do not earn upgrades

**Locations:** `src/fantasyhq/game-submissions.js:120`, `:141`; `player-upgrades-service.js:270`; `test/player-upgrades.test.js:133`.

Production TEAM_SIDES requires the actor to own a matchup team; Staff impersonation of vacant teams is Test Mode only. Staff can collect both real screenshots as STAFF_BOTH. Upgrade reconciliation explicitly ignores that mode. Four valid official human-vs-CPU fixture games in STAFF_BOTH yielded **0 qualifying games and 0 awards**. This exclusion is covered by an existing unit test, so it is a current policy/integration gap rather than a claim that the unit implementation is inconsistent with its test.

Recommendation: decide whether a human playing against CPU should qualify. If yes, persist and verify actual participating coach/tenure independently of upload mode; do not simply credit all Staff-entered CPU games. If no, clearly disclose the exclusion in coach dashboards and rules.

## 6. Discord Findings

### Commands and callback inventory

The 22 serialized definitions are: `mockdraft`, `week`, `activitycheck`, `tradeblock`, `standings`, `stats`, `teamstats`, `upgrades`, `games`, `game`, `bigboard`, `scout`, `toptenpreview`, `schedule`, `ratings`, `player`, `myteam`, `freeagents`, `admin`, `league`, `roster`, `team`.

- No duplicate top-level definitions or definition without a top-level handler was found in the offline validation.
- FA signing is driven by the pinned Sign Free Agent button; absence of a `/fa` slash command is not a dead feature. Trades and upgrades also have persistent channel controls.
- Handler-only `recruiting`, `setup`, `teams`, `transferportal` are absent from the deployed-definition list. Setup activation remains reachable through setup-flow buttons. These are legacy/unregistered handler paths, **A016 — P3**, not evidence that currently registered commands fail.
- Component dispatch in `src/index.js` includes FA, trade, upgrade, week, cleanup, game, My Week/Staff weekly, scouting and mock prefixes. Relevant tests serialize menus/modals/embeds and exercise normal callbacks. This does **not** certify every possible payload against live Discord; live registration and client support for file-upload modal components are UNVERIFIED.
- FA dropdowns paginate at 25; active-target rules bound active-offer rows. Trade/upgrade flows use pages/selectors rather than one unbounded list. Autocomplete caps results at 25. Error helpers handle deferred/replied/expired interactions; confirmation/draft identity, version and expiry checks exist.
- Long work generally acknowledges/defer replies first. Week/cleanup/start confirmations intentionally expire and require preparation again after restart; persistent controls resume from stored records. Draft/approval helper selections held in memory require restarting that step after a process restart.

### Permissions, channel visibility and mentions

`discord-permissions.js` accepts the two named Commish roles or Manage Server for ordinary Staff management. `discord-free-agency.js:20` intentionally accepts named Staff roles for FA proof. Manage Server alone can manage other league operations but is not automatically an FA proof reviewer: document/standardize this permission policy. Role ownership derives the team from its mapped team role, not from a generic Coach/GM label; `coach-identity.js` rejects missing, ambiguous or mismatched role/owner identities. Member fetch failures preserve existing owners instead of declaring coaches absent. Actor refresh mitigates stale gateway caches.

Staff/Committee channels, private offer details and named-role mentions have passing payload/permission tests. Both Commish roles are included in initial game-thread membership and permitted mentions. Live role hierarchy, private-thread reads, privileged intents and notification behavior are NOT VERIFIED.

### A010 — P2 — Replaced coaches remain members of existing game threads

**Locations:** `src/fantasyhq/game-threads.js:65`; `src/index.js:60`.

An isolated thread fixture repaired a game after replacing its coach. Both `oldStillMember` and `newMember` were true. Repair only adds current coaches/Staff; it does not remove obsolete invitations. The owner-change callback does not reconcile game threads. Whether a departed member can still read depends on remaining parent-channel permissions; a member who stays in the league under another team can retain that access. Live effective access is UNVERIFIED, but stale membership is reproduced.

Recommendation: reconcile the desired member set after ownership changes, preserving legitimate Staff membership; test replacement and reassignment to another team with live private threads.

### A009 — P2 — Failed DMs are permanently suppressed

**Locations:** `src/fantasyhq/discord-free-agency.js:304–323`; `player-upgrades-service.js:277–288`; `discord-player-upgrades.js:508`.

FA writes a delivery receipt even when send fails, and the next sweep treats every receipt key as delivered. Two sweeps with a transient send failure made **one attempt**, recorded `failed:true`, and did not retry. Upgrades persist `notifiedThresholds` before sending; errors are logged while balances remain available. Successful transaction persistence is good, but notification recovery is missing. Winner-cut deadlines can elapse without a delivered prompt. Public result/current-offers UI is a fallback for users who find it, not a resend mechanism.

Recommendation: durable outbox with success receipts distinct from failed attempts, bounded retries, visible Staff failure queue and resend. Closed DMs should not undo the asset transaction.

### A015 — P2 — Submitted trade has no cancellation path

**Locations:** public methods of `src/fantasyhq/trade-service.js:535` onward; `discord-trades.js` response controls.

No submitted-trade cancellation service/button was found. GM denial, counter and stage expiry exist. PENDING_PROOF_REVIEW intentionally does not expire in `expireDue`, so a stalled review can retain reservations until Staff acts. Recommendation: actor-bound withdrawal/cancel rules by stage, audit reasons and safe lock release; separately expose overdue proof review to Staff.

## 7. Website Findings

The website uses the same repository/data root and permanent game IDs as the bot. Player and team APIs calculate contracts/value from canonical league data; source ratings snapshots are separate reference imports. Successful trade/FA/upgrade journal commits become visible on subsequent reads. Existing browser tests cover statistics pages, review speed/caching/history, stale response handling, reload guarding, HTML escaping and weekly dashboard privacy.

Important practical limits:

- **A007:** a public malformed asset path can terminate the origin process.
- **A004:** protected admin mutations are not universally journaled; authorization does not make multi-file writes atomic.
- **A018:** website publication is correct locally, but several Discord callers use live totals.
- Website commissioner controls require a configured shared admin key; missing key fails closed. Staff weekly/OCR/media APIs are protected; public team dashboards intentionally omit private transaction details. There is no Discord OAuth team login, per-Staff identity or independent per-user permission model. The operator name is self-entered audit attribution, not a verified account identity.
- Week, cleanup and thread admin APIs require the connected bot runtime; `npm run start:web` alone cannot operate Discord. `test/week-advancement.test.js:20` confirms week/cleanup/thread panels were removed from the HTML, although APIs remain guarded. **A017 — P3:** document Discord as the current path for these controls instead of promising website buttons that no longer exist.
- Existing posted Discord embeds are snapshots. Website refresh and a new Discord command read current roster/value data; there is no guarantee of instantly rewriting every old player/MyTeam message after a trade.

### A014 — P2 — Shared-key and request-size hardening are incomplete

**Locations:** `src/web.js:175` body parser, `:209` admin check; website key storage/access in `web/app.js`.

General admin JSON parsing buffers the entire body without a size bound, unlike OCR review and several operational routes. The generic admin check also accepts `adminKey` in a URL query, which can put credentials into URL/history/log handling; game-review authorization uses the header instead. This is code-inspected exposure, not a demonstrated credential leak. No per-operator identity, rate limit or general abuse guard was found. Recommendation: consistent bounded bodies, header-only secrets, authorization-before-work, and a clear Staff authentication/audit policy. Actual TLS/edge limits and secret/volume configuration are NOT VERIFIED.

## 8. Persistence & Reliability

### What is implemented and tested

- Repository writes use a unique temporary file, file fsync and rename (`repository.js:24`). This prevents ordinary readers from seeing a partially written individual JSON file; it does not itself make multiple files atomic or provide a backup. Directory fsync/power-loss durability is not established.
- Week, trade/FA and upgrade commits use persisted journals with replay; public loaders recover pending commits before exposing the associated data. Tests inject rename failures before and during commit and confirm restored schedules/players/contracts/counters/audit and idempotency.
- Common trade/FA journals include player, membership, pick, trade, FA state and audit records; upgrades journal player+upgrade state/audit. Journals fail loudly on invalid journal content rather than silently choosing a result.
- Game media/attempts/results share a single per-game record and in-process queue. Duplicate attachments, concurrent uploads and repeated finalization are tested. Game records use temp-file rename, but not the same file-fsync helper as the league repository.
- IDs/league/season/schedule identity are validated in official-stat eligibility. Duplicate official scheduled matchups are excluded. FA rejects duplicate player IDs for target availability and checks one active membership for releases; trade preview checks one owner. Data-issue validation reports malformed/duplicate entries, but no universal required-schema validation precedes every repository save.
- Historical box rows retain their game team; trades store ownership history and transaction snapshots. FA releases preserve prior contract in audit while clearing active contract. Season-scoped FA/upgrade/trade records and historical game archives prevent ordinary rollover from mixing statistics.
- Restart recovery handles persisted FA deadlines, pending winner cuts, trade deadlines/messages, upgrades and publication. An interrupted OCR PROCESSING attempt can be retried explicitly; universal automatic requeue of all abandoned OCR jobs is not established. A Discord thread-creation transport ambiguity is blocked for manual linkage rather than risk a duplicate.
- Compatibility/default initialization for older publication and upgrade state exists; it is not a versioned migration/rollback framework.

### Remaining reliability findings

- **A001 — P0:** broad fallback loaders can erase corrupt existing state on the next write.
- **A004 — P1:** some multi-file admin/import operations bypass journals.
- **A011 — P2:** `game-submissions.js:47–57` parses every game archive in `records()` without per-record quarantine. One corrupt archive caused the entire records collection to throw in a fixture. Standings/stats/thread lookup/weekly reporting that enumerate it can fail, including unrelated leagues. Fail-closed integrity is appropriate, but one damaged archive needs isolation plus a visible critical alert and repair workflow rather than poisoning every read.
- **A012 — P2:** regular-season queues/locks (`trade-service.js:10`, `player-upgrades-service.js:68`, `game-submissions.js:6`) coordinate only one Node process. Synchronous journal commits/readers are coherent within the supported co-hosted process; separate writers, replicas or overlapping deployments can overwrite JSON without a cross-process lock/CAS. No two-process regular-season race test was executed. Run one writer per data volume until enforceable coordination exists; mock-specific locks do not solve all league writes.
- **A013 — P2:** no scheduled repository backup, integrity manifest or tested restore operation was found. `Dockerfile` starts `npm start` but does not create a persistent Railway volume or establish backup retention. Actual mounted data root, replica count, deployment overlap and provider backups are UNVERIFIED. Export and restore a whole league plus external game-history/media before a season; a journal is not a disaster-recovery copy.
- **A009 — P2:** notification receipts/award thresholds survive restart, but failed notifications do not reliably retry.
- **A019 — P2:** exposed/default settings are not consistently authoritative. `setup-service.js:41` defaults `gameDeadlineHours` to 168 while `game-threads.js:5` enforces the requested 48 hours. `resultConfirmationRequired` and `playoffTeams` exist in settings but do not supply a mandatory Staff-review gate or playoff seeding. Align UI/settings with actual supported behavior; do not assume editing a setting changes these workflows.

### Fifteen required failure scenarios

| # | Scenario | Assessment and evidence |
|---|---|---|
| 1 | Restart during active FA window | COMPLETE locally: saved deadline/state, `tick` reconstruction and recovery tests; no new hour. Live restart/Discord reconciliation NOT VERIFIED. |
| 2 | Two Staff approve same request | COMPLETE for tested ordinary requests: FA/waiver terminal return, upgrade pending-state guard and trade completed receipt/journal prevent duplicate assets; relevant tests pass. Separate processes remain A012. |
| 3 | Two coaches sign same FA | COMPLETE locally: shared player window/ranking, one roster owner, one completed counter; tie/improvement/deadline tests. Physical two-writer race UNVERIFIED. |
| 4 | Player traded during upgrade request | COMPLETE locally: trade movement invalidation callback plus reconciliation on approval/restart expires stale request without spending balance; tests cover the hook and missed-event recovery. Admin failed moves still A004. |
| 5 | Coach leaves with pending transactions | BROKEN: upgrades reconcile, but trade/FA/waiver old consent still executes, A002; stale thread membership A010. |
| 6 | Game finalized twice | COMPLETE for ordinary supported same-process flow: per-game mutation queue, locked final guard, same-extraction idempotency and once-after-commit callback tests. |
| 7 | Finalized game corrected | MISSING supported workflow: correction service rejects final record; direct fixture mutation is not an operator flow, A005. |
| 8 | Waive player reserved for FA signing | COMPLETE locally: `transaction-locks.js` checks active conditional-release/cut reservations at request and review; release/waiver/trade tests pass. Direct admin override paths need A004's unified validation. |
| 9 | Advance week with unresolved games | COMPLETE local safeguard: normal advance blocks; explicit confirmed force stores unresolved identities, creates no official result and supports later approval/publication. Week 15 final handoff still A003. |
| 10 | Playoffs begin with pending transactions | PARTIAL: tests can set PLAYOFFS and verify upgrade lock/expiry, FA continuation and pending waivers. A coordinated production transition and final policy are MISSING; submitted trades can continue using origin submission. |
| 11 | Discord interaction expires | COMPLETE for tested error/confirmation paths: stale/expired tokens rejected, response helper catches interaction errors; retry starts a fresh flow. Actual client latency/modal expiration NOT VERIFIED. |
| 12 | OCR reads wrong contract values | PARTIAL: raw image kept, private confirmation, missing/invalid field validation, Staff correction and approval. Plausible-but-wrong values require human image comparison; there is no universal accuracy guarantee. Three real contract layouts pass. |
| 13 | Website reads while bot commits transaction | COMPLETE in tested single-process/journal read model: sync commit does not yield between files; loaders replay interrupted commits. Multiple processes/unified admin writes are PARTIAL, A004/A012. |
| 14 | JSON write fails midway through roster movement | COMPLETE for tested trade/FA/upgrade journal recovery; BROKEN for reproduced admin player move, A004. Corrupt-file fallback adds A001. |
| 15 | Restart during winner conditional-cut selection | COMPLETE locally: saved winner, cut deadline/ranking and restarted selection/fallback tests; no renewed hour. Actual resumed private controls and delivered cut DM NOT VERIFIED; notification loss A009. |

## 9. Test Results

No existing tests were changed, weakened or skipped to obtain these results.

| Check | Executed command / method | Total | Passed | Failed | Skipped | Errors / limits |
|---|---|---:|---:|---:|---:|---|
| Full repository check | `npm run check > /private/tmp/leaguebuddy-regular-season-audit-check.log 2>&1` | 432 Node tests | 432 | 0 | 0 | Exit 0; 0 cancelled/todo; TAP duration 109,344.79 ms. |
| Syntax | `node --check` chain within `npm run check`, including entry point, services, website, command definitions and review JS | Configured chain | All completed | 0 | 0 | No parse errors. Not every JS file is individually listed in that script. |
| Types | `tsc --noEmit` within check | 1 invocation | 1 | 0 | 0 | Exit 0; TS config does not make all CommonJS service code statically typed. |
| Existing browser tests | Playwright tests included in Node suite: review, player/team stats, usability and weekly dashboard pages | 6 tests | 6 | 0 | 0 | Isolated local fixtures/stubbed APIs; not live production-browser certification. Subset of 432, not additional tests. |
| Actual offline image OCR | `tesseract-images.test.js` and `contract-images.test.js` included in suite | 7 tests | 7 | 0 | 0 | Includes 5 box-image tests and 2 contract tests; contract image test has 3 supplied-image cases. Subset of 432. |
| Slash definitions | `node /private/tmp/leaguebuddy-audit-commands.cjs` evaluates definition construction/serialization, without dotenv secrets or REST main | 22 definitions | 22 | 0 | 0 | 22 unique; no missing top-level handlers. Actual Discord registration NOT VERIFIED. |
| Lint | Inspected package scripts | N/A | N/A | N/A | N/A | No configured lint command; lint NOT VERIFIED. |
| Build / Docker | Inspected package/Dockerfile; app runs source | N/A | N/A | N/A | N/A | No configured build command. Fresh Docker image build and Railway runtime NOT VERIFIED. |

The standard check required a local browser-capable execution context. The public HTTP crash probe initially could not bind localhost in the filesystem sandbox (`EPERM`); rerunning it in the approved local execution context established the actual `URIError` process crash. The sandbox restriction is not an application defect.

Additional **14 isolated diagnostic observations** were executed. They are negative probes, not 14 passing application tests and not part of the 432-test total:

| Audit command | Observations |
|---|---|
| `node /private/tmp/leaguebuddy-audit-repro.cjs` | Corrupt picks overwritten; old-coach FA executes; old-coach waiver executes; completed-season new offer accepted; completed-season new waiver accepted. |
| `node /private/tmp/leaguebuddy-audit-repro2.cjs` | Old-coach trade consent survives final proof approval; admin write fault leaves player/membership divergence. |
| `node /private/tmp/leaguebuddy-audit-repro3.cjs` | Four Staff-entered human-vs-CPU official games count zero toward upgrades; final correction rejects. |
| `node /private/tmp/leaguebuddy-audit-repro4.cjs` | Failed FA DM attempted once across two sweeps; replaced coach stays invited to thread; one corrupt game archive blocks collection. |
| `node /private/tmp/leaguebuddy-audit-publication.cjs` | Default Discord vs published website scopes disagree before advancement. |
| `node /private/tmp/leaguebuddy-audit-web-crash.cjs` | Isolated HTTP origin process exits 1 on malformed draft asset path. This nonzero exit is the reproduced defect, not a failing run of the main suite. |

Probe scripts/output are temporary audit artifacts under `/private/tmp`; the reproduction steps and outcomes above remain in this report when those files expire. They reuse fixture construction without registering or changing repository tests, operate only on temporary data roots, and never call live Discord or production HTTP endpoints.

### Coverage that exists, and its limits

- Setup/deletion/roles/channels/pins: `fantasyhq-setup`, `fantasyhq-preseason`, `delete-league`, `discord-channels`, `discord-roles`, `role-ownership`, `member-snapshot`, `discord-permissions`, `discord-pins`, start-season tests.
- Schedule/threads/closeout: `fantasyhq-schedule`, `regular-season-weeks`, `game-threads`, `game-thread-cleanup`, `week-advancement`, `game-activity`, weekly dashboard tests.
- Upload/OCR/review/statistics: `game-submissions`, `box-score-*`, `tesseract-images`, `player-fuzzy-match`, `standings`, `player-stats`, `team-stats`, their Discord/page tests.
- Transactions/contracts: `trade-service`, `trade-repository`, `discord-trades`, `player-upgrades`, `discord-player-upgrades`, `free-agency-service`, `discord-free-agency`, `contract-images`, `contracts`, `player-contract-impact`, `asset-valuation`, MyTeam/usability tests.
- Adjacent mocks/scouting/branding/trade blocks/activity check are also covered in the same full run, but their tests do not replace regular-season lifecycle coverage.

**Important missing regression coverage:** corrupt canonical state followed by unrelated commit; owner replacement at every trade/FA/waiver stage; authenticated admin multi-file failure recovery; public malformed-route process survival; actual Discord publication caller wiring; a full finalized-result correction with upgrade reconciliation; full production Week 15→Playoffs; transient failed-DM retry; obsolete private-thread member removal; multi-process writers; backup restore; large-scale 210-game season performance under concurrent OCR/reviews. No production load/performance benchmark or live multi-user season was executed.

## 10. Regular Season Readiness Score

**64 / 100.** This is an engineering assessment against this request, not measured branch coverage, a probability of success, or approval to run a live league. P0/P1 findings independently block readiness even when many ordinary features work.

| Criterion | Weight | Credit | Basis |
|---|---:|---:|---|
| Required regular-season functionality | 40 | 30 | Schedule, ordinary games, stats, trades/upgrades/FA/waivers have tested implementations. No credit for missing playoff handoff, seeding, final reversal, administrative final outcomes or cancellation. |
| Complete cross-system workflows | 25 | 15 | Journals/current roster-value-contract reads work on normal paths. Deduct for old-coach consent, human-vs-CPU earning gap, publication mismatch and stopped season-ending chain. |
| Persistence and failure recovery | 20 | 10 | Passing journal/idempotency/restart tests earn credit. Corrupt-state erasure and unjournaled admin writes are major deductions. Backup restore/multiple writers get no unverified credit. |
| Security and permission enforcement | 10 | 6 | Tested role/current-owner checks, private proof and admin-key guards earn credit. Deduct for public route crash, stale consent/invitations and incomplete request hardening. |
| Operational verification and usability | 5 | 3 | Real offline OCR, browser checks, command serialization and Staff/coach dashboards earn credit. Live Discord delivery, deployment/volume/backup checks and full-season rehearsal earn zero until verified. |
| **Total** | **100** | **64** | Tested subcapabilities receive partial credit within PARTIAL/BROKEN systems; the broken workflow itself receives none. |

COMPLETE counts are based on the 13 matrix rows, not the number of passing tests or individual subfeatures. Overall counts: **COMPLETE 2; PARTIAL 8; BROKEN 3; MISSING 0; UNVERIFIED 0.** Missing/unverified subcapabilities are separately classified above so they cannot be mistaken for completed work.

## 11. Prioritized Repair Roadmap

No implementation was performed. Complexity estimates describe relative scope, not a promised delivery time.

### Phase 1 — Must Fix Before Live Testing

1. **A001: fail closed on corrupt canonical data.** Medium complexity. Add schema-aware loading, explicit first-use initialization and regression probes. Foundation for every later repair.
2. **A007: public route crash containment.** Small complexity. Controlled decoding/request boundary and real HTTP regression. Independent of season policy.
3. **A002: invalidate/reapprove consent on coach changes.** Medium/high complexity. Depends on an explicit successor policy and shared owner/tenure identity at commit. Cover trade, FA, waiver and winner-cut stages.
4. **A004: journal all admin roster/player/import mutations.** High complexity. Depends on A001 and shared roster/transaction validation; preserve historical and audit consistency.
5. **A003: confirmed season completion/PLAYOFFS handoff and eligibility cutoff.** High complexity. Depends on commissioner tiebreak/seeding and pending-operation policy; use a single durable transition.
6. **A005/A006: controlled final-result correction and official administrative results.** High complexity. Depends on defined forfeit scoring/stat eligibility and correction/award/publication policy; exercise dependent stats and upgrades end-to-end.

### Phase 2 — Core Integration Fixes

- **A018: unify published/public statistics scopes.** Small/medium. Keep Staff operational live totals explicit; test website, slash commands, MyTeam and pins in the same fixture before/after advance.
- **A008: settle human-vs-CPU upgrade eligibility.** Medium. Depends on league policy; persist verified participation independently of Staff upload mode if qualifying.
- **A010: owner-change thread membership reconciliation.** Medium. Depends on desired Staff access policy; handle both departure and reassignment within the server.
- **A015: submitted-trade withdrawal/cancel and overdue-proof Staff controls.** Medium. Depends on stage/consent cancellation rules; release locks and preserve history.
- Add a structured game rejection decision with actor/reason and retry guidance. Small/medium; use the same revision rules as A005.

### Phase 3 — Reliability & Edge Cases

- **A009:** durable delivery outbox/retry/resend. Medium; ensure failed delivery never rolls back assets and cutoff prompts remain recoverable.
- **A011/A013:** game-archive integrity alerts/quarantine and complete backup/restore rehearsal. Medium; align with canonical fail-closed policy and preserve original files.
- **A012:** enforce single writer immediately, then add real cross-process coordination if multiple processes/overlapping deployments are required. Medium/high, depending on storage architecture. Verify hosting deployment overlap rather than assuming one replica is sufficient.
- **A014:** consistent body limits, header-only credentials and audited Staff identity policy. Small/medium.
- Exercise crash-at-each-stage, pending OCR restart, late reviews, deleted Discord messages/threads, asset conflicts and an entire 210-game season with bounded OCR/review load. Medium.

### Phase 4 — Optional Polish

- **A016/A017/A019:** retire/document unused command handlers, clarify which operations are Discord-only, and align configuration labels/defaults with actual supported policy. Small.
- Explain “approved automatically” versus “Staff reviewed,” “decision recorded” versus “official final,” and published versus operational totals. Small; correctness fixes precede wording.
- Make stale MyTeam/player snapshot refresh obvious; improve failed-DM/overdue-proof visibility without adding duplicate entry points. Small/medium.

**Recommended next implementation task:** A001, with regression tests proving corrupt existing files cannot be silently replaced by a successful unrelated transaction. A007 can be addressed independently immediately afterward. Do not start by changing cosmetic embeds or assuming all green tests establish season readiness.

## 12. Final Live Test Checklist

Perform this on an isolated test league/server after Phase 1 fixes, with a real second user for permission/privacy checks. One-user Test Mode proves simulation tooling, not isolation between online coaches. Keep production data untouched until readiness gates pass.

1. **Prepare deployment and recovery:** verify one active writer, persistent data root/volume, privileged Discord intents, bot hierarchy, website origin/TLS and admin key. Export a complete test league plus game-history/media; restore to a second test directory and compare records/contracts/counters. Verify a malformed asset request returns an error while bot/website stay alive.
2. **Create/import/setup:** create one league, import all 30 teams and official FA pool/contracts, assign at least two real coaches, create roles/channels and run repair twice. Verify no duplicate channels/pins, renamed/deleted-channel recovery, ambiguous roles fail safely, and both Commish roles can perform permitted work. Confirm ordinary coaches cannot read Staff/Committee/other private proofs.
3. **Validate schedule/preseason:** confirm 15 weeks, 210 games, conference-only opponents, 14 games and one bye per team. Verify protected website roster/value/contract views against Discord and source-import separation. Test season-start preview/cancel/confirm, unauthorized and expired confirmation. Starting twice must not reset progressed weeks.
4. **Launch Week 1:** create 14 private threads; verify current coaches and both Staff roles, exactly one shared 48-hour deadline and correct bye teams. Retry after a partial Discord failure without duplicate threads/deadline reset. Inspect each real user's private-thread visibility, not just role labels.
5. **Play the three matchup types:** finish user-vs-user, user-vs-CPU and CPU-vs-CPU with the proper proof workflow. Staff weekly report must show only counts/completion totals by type; coach dashboard must show relevant games on website and MyTeam. Message edits during the week should preserve one Staff report; next week should create a new one.
6. **Exercise uploads and OCR:** submit each user's own side; retry duplicate attachments; reject wrong team/guild/thread, non-image and excess files. Use actual screenshots and camera photos including the supplied problematic layouts. Confirm uncertain fields require review, correct player identity/nickname and numbers, retain originals/revision history, and confirm the announced final score/approval signal.
7. **Exercise rejection/correction/finalization:** reject or retry a bad attempt, approve the latest valid revision, click approval twice and concurrently as two Staff. Perform one supported post-final correction/reversal after its implementation; verify audit revisions, no duplicate result, standings/player/team stats and earned upgrades reconcile.
8. **Validate publication:** before advancing, public standings/stat pages, pins, `/stats`, `/teamstats` and MyTeam must agree on the previous published week. Staff operational progress can update live with a clear label. Compare GP/W/L, scores, totals, averages, weighted shooting and current/historical team attribution.
9. **Close Week 1:** attempt normal advance with unresolved games (must block), cancel preparation, expire a confirmation, then complete remaining proof/admin outcomes and confirm once. Separately test explicit force advance in the disposable league: unresolved records retained, no fabricated wins or player stats, late approval included only at the next publication. Check new week/report/threads and unchanged historical archives.
10. **Test trades through Week 9:** make balanced two- and three-team player/pick trades; test value/15-player/duplicate-asset/5-trade limits, coach denial/counter, Committee eligibility and proof rejection. Staff approve once; compare roster/picks/contracts/value/history on both surfaces. Change ownership or waive/reserve an asset midflow and verify invalidation. Exercise cancellation after it is implemented.
11. **Test upgrades:** accumulate verified games 1–4, including the agreed human-vs-CPU policy; check earned balance and DM, then repeat reconciliation/restart. Use normal allocation limits and each Special in separate team/season fixtures. Test new-user entitlement, repeat category, two/player and one Special/team limits, Staff rejection, rating/build modes and +8 lb strength result; verify value/history/profile updates.
12. **Test FA competition:** use the three supplied contract screenshots; confirm MINIMUM needs actual numeric salary, private bidding, Staff correction and immutable original hour. Submit competing, improved, equal/worse, withdrawn and pending-review-at-deadline offers; inspect public privacy. Verify two-target/five-signing limits, signed contract and roster/counter/audit updates exactly once. Test conditional release, invalid release, winner cut/fallback and overdue Staff review.
13. **Test waivers:** select via MyTeam, verify locked/reserved players cannot be waived, Staff reject/approve twice, active contract clears while audit retains it, FA availability and one public announcement update. Confirm a waiver does not restore an FA signing slot.
14. **Replace/depart a coach midweek:** change team roles with pending trade, FA, waiver and upgrade requests. Verify all old consent is handled under the agreed policy, successor gets appropriate tenure/new-user state, old balances cannot be spent, and old private-thread invitations are removed while correct Staff access remains.
15. **Restart and failure drills:** restart during active FA, pending review, winner cut, collecting screenshots and pending upgrade/trade proof. Check saved deadlines and no duplicate messages/assets. Force a transient DM failure then verify retries/Staff alert. Run storage fault/corrupt-file drills only against copied test data; verify no silent empty replacements and journal/admin recovery.
16. **Weeks 2–14:** repeat normal advance/publication and retain exactly one Staff report per week. Check bye weeks, trade cutoff after Week 9 with earlier submissions handled correctly, per-season counters, late finalizations, historical team stats after trades, cleanup preview/cancel/confirm and continued review/media access after deleting threads.
17. **Week 15 and playoff handoff:** resolve or explicitly decide every unfinished game/pending operation, publish final regular-season records, validate agreed tiebreaks/seeds, confirm the supported PLAYOFFS transition. New forbidden actions must fail server-side; approved continuation paths must follow saved deadlines. Verify no late regular-season upgrade or new FA/waiver process sneaks through completed-season state.
18. **Preserve/roll over:** export final standings/seeds/stats/contracts/transactions/audit/media, restart and compare. Test next-season resets and tenure/new-user rules while historical logs remain queryable. Complete a restore rehearsal and sign off both Staff/coach multi-user privacy before enabling production.

**Audit conclusion: NOT READY.** The existing implementation is substantial and its tested normal paths work, but the reproduced data-loss/availability/ownership failures and missing season-ending workflow prevent safe full-season readiness.
