# General app usability audit — October 7, 2026

Reviewed the exported Discord command menu, interaction router, persistent channel pins, setup/scheduling/week progression, team identity, rosters, trades, Free Agency/waivers, live mocks, game threads/submission/review, upgrades, website navigation/statistics and commissioner tools. Source review and isolated service/browser tests cover the findings below. No real offers, roster moves, week advancement, deletions or test-clock changes were performed during the audit.

## Command inventory and overlaps

The actual exported menu has **22 unique top-level commands**. Historical builder definitions for retired actions remain in the source, but are filtered out before registration. A source-text search alone overstates the visible menu. No duplicate command registrations were found.

| Commands | Purpose and overlap assessment |
| --- | --- |
| `/myteam`, `/team list`, `/team roster` | Personal summary versus league directory/another team's full roster; keep these distinct. |
| `/player`, `/stats`, `/teamstats` | League player profile versus official published player/team stats; distinct data views. |
| `/ratings team/player/top` | Reference source snapshots, which can differ from edited league rosters. Keep as recovery/reference tools; describe that distinction more prominently in a future menu pass. |
| `/freeagents` | Available league player browsing; signing uses the existing FA pin/private workflow. The list now links directly to signing and has pagination buttons. |
| `/bigboard`, `/scout`, `/toptenpreview`, `/mockdraft` | Board browsing, paid scouting unlock, class preview and deterministic projection. Live mock remains a separate interactive pinned flow. |
| `/schedule generate/preview/mine/week/team/full` | Staff preview generation/recovery plus personal, weekly, team and downloadable views. Confirm/regenerate remain attached to the actual preview. |
| `/league create/setup/settings/roles/delete`, `/admin bind`, `/roster import/freeagency`, `/team assign/unassign` | Primary setup and explicit repair/recovery paths. The repair button already creates roles; `/league roles` remains a useful targeted fallback. |
| `/week advance`, `/games create/cleanup`, `/game setup` | Confirmed progression, confirmed thread replacement/cleanup, and manual linking of an existing thread. These have different effects; do not combine deletion with week advancement. |
| `/upgrades`, `/tradeblock add/remove/setup`, `/activitycheck` | Personal upgrades, coach listings/Staff thread setup, and Staff activity checks. Trade machine and FA operate through pins instead of extra slash commands. |

## Findings and changes

| Priority | Finding | Result |
| --- | --- | --- |
| High | FA entry said “1 hour” while this league's test clock is 60 seconds. | Pin uses the same duration function as offer creation and explicitly identifies Test Mode. Existing deadlines stay immutable. |
| High | Test clock could be shortened from a button, but not restored from one. | The same control toggles between USE 60s TEST CLOCK and RESTORE 1h CLOCK; changes are audited and refresh the pin. No live setting was changed by the audit. |
| High | Final game cards retained a wall of disabled actions and an apparently available CPU action. | Final cards show no game-action controls. Persistent card version changes refresh older approved cards. Server validation of old buttons remains intact. |
| Medium | Approval text implied stats were visible immediately, contrary to weekly publication. | Both the game card and new approval receipt explain that the result is recorded and stats/standings publish when the week advances. |
| Medium | FA browsing required another command for each page and had no next step into signing. | Previous/Next preserve the filter; SIGN FREE AGENT opens the existing private workflow. Slash page arguments still work. |
| Medium | FA position filters differed between browsing and signing. | Both now use primary position. Players with secondary positions are no longer inconsistently listed in different pools. |
| Medium | Mock prospect confirmation offered only a final commit. | BACK TO PLAYERS returns to selection without consuming a prospect or extending the clock. Confirmation remains final and revalidates the current pick. |
| Medium | Regular-season setup checklist offered repair/refresh but no progression path. | REVIEW WEEK ADVANCEMENT opens the existing Staff-only preview/confirmation. It does not advance a week on click. Stale league buttons are rejected. |
| Medium | Website standings reload could overlap and erase the table after a temporary failure. | Concurrent reloads are coalesced; the button disables during loading; a failure preserves the last table and explains that it is showing older data. |
| Low | Website refresh wording suggested recalculating unpublished games. | Buttons say RELOAD PUBLISHED STANDINGS / TEAM STATS / STATS. Publication still requires week advancement. |
| Low | Setup explanation omitted FA and still claimed 17 channels. | It now identifies 18 channels, the FA pin and private Staff review. Command audit records the current 22-command/35-role inventory. |

## Continued audit

- Active matchup cards now show one Staff tools button instead of public Staff Submit, OCR recovery and solo-test controls. The menu is ephemeral, checks the actual Commissioner/Assistant Commissioner roles or Manage Server, and validates the game's private thread and unlocked state. Existing action IDs continue to work with their existing authorization. Opening this menu does not count as coach game participation. Card version 7 refreshes existing active cards.
- Season start and readiness controls share a busy state. Confirmation blocks competing checks; Cancel restores the controls; submission accepts one action and restores controls on failure. Browser regression covers repeated clicks, cancellation and error recovery.
- All reference ratings cards identify their snapshot source. Team/player/top/free-agent cards point to the corresponding current league command so reference contracts and availability are not mistaken for live league data.

## Remaining recommendations

| Priority | Area | Recommendation and reason |
| --- | --- | --- |
| Medium | Setup navigation | Keep one phase-aware checklist as the primary Staff entry. Advanced import/bind/role repair commands should be documented as recovery, not presented as another required setup sequence. |
| Medium | Season transition | Week 15 deliberately ends regular season without starting playoffs. A complete explicit playoff/next-season workflow is still needed; no automatic phase transition was invented during this audit. |
| Low | Mock order controls | LOCK ORDER and START DRAFT overlap visually but have distinct effects: lock freezes an order without starting the timer; start locks and begins. Keep both until an agreed room layout consolidates optional host controls. |
| Medium | Staff command visibility | Staff roles are checked by the app and have no built-in Manage Server permission. A blanket Discord default-permission filter would hide valid Staff tools; configure integration command access by the actual Staff roles in a future menu pass. |
| Low | Feature discovery | A small “where to do what” guide linking MyTeam, FA, trade, scouting, upgrades and game channels would help new coaches. Avoid adding another command for each existing feature. |
| Low | Website versus Discord | Add a clear read-only website hint that offers, waivers and trades are initiated in Discord; do not add a competing transaction flow. |
| Low | Website stats reloads | Player/team stats already guard concurrent loads; apply the same preserved-table error feedback used for standings in a future pass. |

## Validation and deployment

`npm run check` passed **418 tests, 0 failures**, including syntax checks, TypeScript validation, all existing OCR/browser tests and the new flow/browser regressions. Focused flow checks passed 42 tests; approval/activity checks passed 34; week/authorization checks passed 18. Logs: `/private/tmp/leaguebuddy-usability-validated.log`, `/private/tmp/leaguebuddy-usability-focused.log`, `/private/tmp/leaguebuddy-usability-approval-check.log`, `/private/tmp/leaguebuddy-usability-week-check.log`. Railway deployment `15a57dca-4957-422f-89f1-ee0338302c91` succeeded. Live browser checks at 1440px and 390px found no JavaScript errors or horizontal overflow. The standings deep link reached the intended section after initial data loading and smooth scrolling. Published standings remained Through Week 1 / 14 games during the audit. Screenshots: `/private/tmp/leaguebuddy-usability-live-1440.png` and `/private/tmp/leaguebuddy-usability-live-390.png`. The existing FA pin `1557501766545707059` was reused, stayed pinned, and now correctly shows 60 seconds (Test Mode). Both Test Mode and its clock setting were verified unchanged. The new free-agent pager is installed in the running service. The audit does not remove existing recovery commands, change publication policy or automatically change this league's test settings.

Continued audit validation: `npm run check` passed **420 tests, 0 failures** (syntax, TypeScript, browser and OCR checks). The game/activity focused suite and the two usability browser regressions also passed. Log: `/private/tmp/leaguebuddy-continue-validated.log`.

Continued audit deployment `c34eafa0-7e27-4884-bab7-430f37d3bef1` succeeded. Live desktop (1440px) and mobile (390px) checks found no JavaScript errors or horizontal overflow; standings still show Through Week 1 / 14 published games. The served app.js contains the season-start guard. Read-only Discord checks found 13 open game cards; the three sampled cards carry version 7 and correctly remain date-gated. No open cards currently have dates, so the unlocked Staff menu was validated in isolated regression tests rather than by changing a live game date. The league remains REGULAR_SEASON with Test Mode enabled and its existing 60-second FA test clock unchanged.

## Weekly dashboard follow-up

The coach weekly dashboard and Staff closeout checklist are now implemented in the existing website and Discord flows. MyTeam has MY WEEK; Staff receives one report per week with ownership-based CPU/user matchup totals and pending game/transaction work. The website offers a public team progress view and a protected Staff investigation queue. Reports update in place and old week reports are retained as closed records. Details and operating instructions: [WEEKLY-DASHBOARDS.md](WEEKLY-DASHBOARDS.md). No additional slash commands were added.

Weekly dashboard validation: the final complete check passed **432 tests, 0 failures**. Log: `/private/tmp/leaguebuddy-weekly-validated.log`.

Weekly dashboard deployment `7396d9be-e1a6-48c0-abd5-d887e1505aea` succeeded. The Week 2 Staff report is posted in the existing private Staff channel. Live protected/public API checks and desktop/mobile dashboard checks passed; week, Test Mode and FA test clock settings remain unchanged. See WEEKLY-DASHBOARDS.md for the report link, live totals and access instructions.
