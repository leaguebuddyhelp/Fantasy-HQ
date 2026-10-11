# Phase-lock repairs — October 10, 2026

Implemented locally; not deployed. Live league phase, Discord channels/messages and production league data were not changed.

## Resulting behavior

| Workflow | Rule |
| --- | --- |
| Regular game uploads, date/stream controls and extraction entry | Current season, REGULAR_SEASON not completed, sole ACTIVE week matching league week and game identity, scheduled matchup and unlocked game. |
| Playoff uploads/extraction entry | PLAYOFFS, current stage/series, latest open game, no correction conflicts and unlocked game. Same rule for Staff submissions. |
| Sportsbook new markets / wagers | Same competition window as the game. Wager confirmation rechecks current data; game locking/finalization closes betting. |
| Historical game review / result correction | Existing authorized review path retained; original media/results remain stored. |
| Sportsbook settlement / wallet / bet history | Retained across phase closure; past wagers are not deleted or repriced. |
| Bulk scanner import | Current season, SETUP or PRESEASON only; direct API requests cannot bypass the UI lock. Use the dedicated offseason import flows afterward. |
| Generic roster/player mutation | Routine edits only in SETUP/PRESEASON. Later edits require a reason and a commissioner correction preview/confirmation. |
| Commissioner roster correction | Exact action/details, actor, league, season and source data bound to a one-use token with five-minute expiry. Reasons and approvers recorded in audit history. |
| Corrective team moves | End the old membership and create a new membership; do not rewrite past team attribution. |
| Mock drafts | Open with Big Board release. Early preview remains available before regular season; stale live controls and player menus reject closed phases. Cleanup/recap recovery retained. |
| Regular-season FA entry | Closed phases disable new signing on the pin; stale signing/waiver entry buttons recheck phase and season completion. Active offers remain accessible. Offseason FA uses its separate stage rules. |

Shared enforcement lives in `competition-window.js`, `roster-corrections.js` and the existing domain services. This avoids relying on hidden website panels or disabled Discord buttons for enforcement.

## Verification

Tests run in a temporary copy without `.env` or production league data. Local browser/HTTP checks require execution outside the macOS filesystem sandbox.

Regression coverage includes stale phase/week controls, uploads crossing a phase change, closed-phase wager confirmation without wallet charges, postseason game identity, settlement after season close, direct roster API bypass, unauthorized/tampered/stale/reused correction confirmations, membership history preservation, crash recovery, preseason mock controls, and the website correction dialogs.

## Limits

- No production acceptance test or deployment has been performed for this patch.
- Correction preview tokens intentionally expire on process restart; preview again if the bot/server restarts.
- Historical records are preserved. Existing pre-patch memberships that were previously overwritten cannot be reconstructed automatically by this change.
- A complete consolidation of all phase-related UI descriptions is a future maintenance improvement; repaired writes enforce their rules in backend services.

Final `npm run check` passed: **671 tests, zero failures**, including TypeScript checks, browser tests and the full season/postseason simulation. A subsequent mock regression run passed **72 tests** after an additional stale-player-menu guard. Separate correction API and browser checks also passed. Evidence is stored locally under `reports/phase-lock-repairs-2026-10-10/`.
