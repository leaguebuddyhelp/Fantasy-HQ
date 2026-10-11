# Season phase audit — October 10, 2026

Scope: repository review of Discord commands/components, website controls/API routes, and underlying services. No deployment, live phase change, or live league-data mutation was performed. This is a phase-lock audit, not a new complete launch/security certification.

## Implemented in this change

- A shared policy selects **Early Top Ten in SETUP/PRESEASON**, then **Big Board in REGULAR_SEASON, PLAYOFFS, OFFSEASON, DRAFT and FREE_AGENCY**.
- Selection remains season-bound: CUS01 → Season 1, CUS02 → Season 2, CUS03 → Season 3, CUS04 → Season 4. A missing next class blocks browsing rather than borrowing another season’s players.
- Discord `/bigboard`, player selection, pagination and autocomplete use the currently available board. `/toptenpreview`, including old preview buttons, rechecks phase and closes when regular season starts.
- Website class metadata exposes only the active board. The prospect API rejects requests for the closed board, including old URLs. Navigation and board sections follow the same rule. Background league refresh detects phase/season changes and updates the board; an open prospect modal closes on that change.
- Rollover already increments season and returns to PRESEASON; the next class’s early preview therefore opens automatically.
- Scouting-point spending now also rejects a regular season marked COMPLETED, even if an inconsistent ACTIVE week remains in storage.

Evidence: `src/shared/season-draft-class.js`, `src/fantasyhq/scouting-service.js`, `src/fantasyhq/discord-scouting.js`, `src/index.js`, `src/web.js`, `web/app.js`.

## Current action matrix

Read-only standings, stats, rosters, contracts, news and historical records should remain accessible throughout the season. Lock writes rather than hiding useful history. Staff correction permissions require separate treatment from ordinary coach actions.

| Action | Current permitted window | Enforcement / assessment |
| --- | --- | --- |
| Setup settings, generate/confirm schedule, enter preseason | SETUP | Server-side guards in `setup-service.js`; Discord setup controls reflect phase. |
| Import scanned free agents | SETUP / PRESEASON | Server-side guard in `setup-service.js`. |
| Start regular season | PRESEASON | `league-service.js` validates saved schedule and preseason readiness. |
| Advance regular-season week | REGULAR_SEASON | `week-advancement.js` checks current phase, confirmation, unresolved games and current week. |
| New trades | Regular-season Weeks 1–9, or OFFSEASON/TRADES step | `trade-service.js` enforces window; already-submitted trades have deliberate continuation rules. |
| New regular-season FA windows / waiver requests | Active REGULAR_SEASON | `free-agency-service.js` rejects new windows/waivers after completion or outside phase. |
| Existing regular-season FA window closeout | REGULAR_SEASON, with controlled PLAYOFFS continuation | Deliberately supports windows started before playoffs; not equivalent to opening new windows. |
| Upgrade requests and approvals | Active REGULAR_SEASON | `player-upgrades-service.js` validates active season/phase and completion state. |
| Scouting board | Early before regular season, Big Board afterward | Shared phase policy implemented here. |
| Spend scouting points | Active REGULAR_SEASON week only | Requires one matching ACTIVE week and season not COMPLETED. |
| Start playoffs | Completed regular season | `season-transition.js` enforces completion and confirmation. |
| Playoff game submission / series operations | PLAYOFFS and correct open series/game | `postseason-service.js` and `game-submissions.js` enforce series progression; see Staff path gap below. |
| Awards | Regular season complete; conference/finals awards additionally require finished relevant series | `awards-service.js`; corrections require reason. Completion-driven rather than one phase only. |
| Offseason imports, draft, options, retirement processing | Corresponding offseason step and matching phase | Offseason services validate phase + step, receipts and confirmation digest. |
| Offseason FA | FREE_AGENCY and matching unfinished step/stage | `offseason-free-agency.js`. |
| Cutdown / offseason roster tools | Corresponding offseason step | `offseason-roster-service.js`. |
| Season rollover | Completed offseason requirements | `offseason-service.js`; next season starts PRESEASON. |
| Ordinary regular-season game uploads / streamlink | Unlocked current-season game, matching thread and actor | Missing consistent phase/week recheck; P1 below. |
| Sportsbook wager placement | Current-season open market and unlocked game | Missing explicit league-phase gate; P1 below. |
| Generic Staff roster edits/import | Authorized Staff/commissioner, with identity/transaction checks | No uniform phase lock; P1/P2 recommendations below. |
| Weekly/live mock drafts | Current class, simulation safeguards | No phase gate. Practice simulations do not change actual draft receipts. Policy decision below. |

## Initial findings and repair priority (subsequently repaired)

### P1 — Ordinary game actions can outlive their intended phase

`game-submissions.js:check` validates season, thread, owner and game lock. Its regular-game branch does not require REGULAR_SEASON or the active schedule week. `authorizeExtraction` has a Staff branch that bypasses the ordinary check, so postseason/current-game checks are not consistently applied to that path. Streamlink authorization uses this service as well.

Recommended repair: centrally validate ordinary coach upload/stream actions against the current active regular week, and playoff actions against the current open series/game. Keep explicit authorized historical correction/review operations available with audit evidence. Do not blanket-lock stored screenshots or completed-game history. Add stale-button, phase-change-between-upload-and-submit, Staff postseason, and archived-season regressions.

### P1 — New Sportsbook wagers lack a league-phase check

`sportsbook-service.js:refresh` and `selections` use season, market status, game lock/start/finalization and own-team restrictions. They do not check `league.currentPhase`. An unlocked current-season game can therefore remain a candidate outside the intended competition phase.

Recommended repair: reject new previews/confirmations except active REGULAR_SEASON or PLAYOFFS, and require that the game belongs to the current active week/open postseason series. Recheck on confirmation. Keep wallet/history reads, settlement and Staff corrections available after competition closes.

### P1 — Bulk roster import is only hidden in the regular-season website UI

`web/app.js:updateAdminPanelVisibility` hides the import panel in REGULAR_SEASON, but `/api/league/admin/import/apply` delegates to `roster-service.js:applyRosterImport`, which has no phase check. This is an authorized-commissioner bypass of the intended UI restriction, not an unauthenticated access finding. The panel also reappears in PLAYOFFS.

Recommended repair: make the scanner bulk-import endpoint SETUP/PRESEASON-only; keep the existing verified offseason import workflows for offseason changes. Use a separate explicit correction workflow if exceptional live-season repairs are required.

### P2 — Generic roster editing needs an explicit correction policy

`roster-service.js:movePlayer`, `removePlayer` and `bulkUpdateRoster` enforce data/transaction rules, but do not have a common season-phase policy. Administrative edits can bypass coach trade/FA windows. Some of these capabilities are useful for legitimate corrections, so removing them outright would damage recovery workflows.

Recommended repair: keep routine moves in the trade/FA/offseason flows; require a reason, preview/confirmation and audit metadata for exceptional Staff corrections during competition. Preserve historical memberships. The precise correction policy should be agreed before changing these tools.

### P2 — Mock draft availability needed explicit phase messaging and stale-control checks

The initial audit described mocks as independently reading the full class. Follow-up tracing established that `mock-simulations.js:inputFor` actually delegates to the phase-aware scouting board introduced in the same change. That already prevented a complete preseason mock (fewer than 30 players), but produced an unhelpful error and did not consistently close cached live controls.

Repair: explicitly gate mock generation until Big Board release, disable the preseason live-mock start button with an Early Top Ten explanation, recheck stale live controls and available-player menus, and skip background generation while the early preview is active. Completed recap delivery and cleanup remain available.

### P2 — Phase controls are distributed across services and UI

There is no single action/window map shared by Discord pins, website controls and backend services. Existing service guards are valuable and should remain, but UI affordances can drift from them (bulk import is one example). `/bigboard` command description has been updated locally for its dual-phase behavior; deployed command registration still requires the normal deployment step.

Recommended repair: introduce a shared, read-only availability description (allowed, reason, continuation/correction exceptions) and let UI controls consume it. Keep mutation services responsible for rechecking authoritative context at execution time. Refresh permanent Discord panels when phase changes, and always reject stale actions in the backend.

## Verification

- **124 targeted automated tests passed** across scouting, season class mapping, setup, trades, regular-season free agency, upgrades, week initialization, postseason and offseason services.
- **1 Playwright browser regression passed**, checking the visible board, hidden sections/navigation, and one active-board request for all four season classes. Chromium required execution outside the filesystem sandbox; the first sandbox attempt was blocked by macOS browser permissions, then the permitted rerun passed.
- JavaScript syntax checks for changed entry points and `npx tsc --noEmit` passed.
- Website API tests cover all seven phases for Seasons 1–4, default board resolution, stale class parameters, closed-board rejection and missing Season 5 data.
- Scouting tests cover phase transitions, rollover to the next early preview, blocked spending outside regular season and COMPLETED season handling.
- No production Discord interaction or deployed website acceptance test was performed for these edits. No new readiness score is assigned by this focused audit.


## Repair follow-up — October 10, 2026

All three verified P1 phase gaps have been repaired locally:

1. Shared `competition-window.js` checks current season, phase, completion, the sole ACTIVE schedule week and matchup, or the current open postseason series/game. Coach and Staff upload/stream/extraction entry points use it. Uploads recheck after asynchronous downloads.
2. Sportsbook market refresh and wager confirmation use the same guard. Out-of-window markets close; locked/finalized games cannot accept new wagers. Existing bets, settlement, wallets and correction history remain accessible.
3. Bulk scanner roster import requires SETUP/PRESEASON and the current season in the service; the website hides the import panel throughout competition and offseason.

The generic roster-edit policy gap is also repaired. Routine move/remove/bulk edit/player patch/add actions are setup/preseason-only. Later changes require a commissioner-only correction preview, a 10–1000 character reason and a one-use, five-minute token bound to exact changes, current source data, league, season and actor. Changed data or credentials invalidate confirmation. Website controls guide the commissioner through reason → preview → confirmation. Audit entries store the correction reason and approver. Team movement closes the prior membership and starts a new one, preserving historical team attribution.

Discord FA pins now disable new signing controls in closed phases while retaining active-offer access, and stale regular-season entry buttons recheck phase/completion before starting a new private workflow. The dedicated offseason FA handler remains separately gated.

The broader suggestion to consolidate every UI availability description remains an architectural improvement, not an unresolved verified bypass. Shared guards now cover the repaired mutation paths. Existing trade, upgrade, postseason and offseason business rules remain in their domain services.

No deployment or live data mutation was performed. See `PHASE-LOCK-REPAIRS.md` for final verification evidence and practical limits.
