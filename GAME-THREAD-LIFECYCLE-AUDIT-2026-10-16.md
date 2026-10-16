# Weekly game-thread lifecycle audit — October 16, 2026

## Weekly routine

1. Start the regular season after roster/schedule validation. Week 1 becomes ACTIVE. Run `/games create` to create its 14 private matchup threads. This is the only creation entry point.
2. The first successfully obtained Discord thread starts the shared 48-hour clock. Every matchup receives that deadline. Retries, repairs and explicit replacements preserve it.
3. Coaches use their matchup thread to arrange the game, set its 2K date, submit a Streamlink and upload both box scores. Only the participating coaches and league staff receive private-thread access. Approval remains separate from thread creation.
4. Staff use **Review & Advance Week** or `/week advance`. Normal advancement requires all 14 scheduled games to have valid approved results. Force advancement remains an explicit confirmation and records unfinished games without fabricating results.
5. Confirmation publishes the completed week's stats/standings, activates exactly one next week and refreshes the weekly announcement/report. Staff then run `/games create` for that week. The same routine repeats through Week 15; there is no Week 16. Playoff seeding is a separate confirmation.

## Repaired findings

- `/games create` previously required deleting/replacing every existing thread. It now creates missing threads and repairs/reuses existing ones. Destructive replacement is available only through `/games create replace:true` and its existing confirmation.
- Creation is command-only following the user’s policy correction. Startup, timers, owner changes, week/round advancement, postseason refresh/finalization, staff buttons and website actions cannot create threads. `/games create` handles both regular-season and postseason creation; staff retry the same command after failures.
- Creation captured a schedule before awaiting Discord/ownership operations and could write it after another operation changed the active week. It now rechecks league/season/week before continuing and updates the latest schedule when starting the clock. Creation locks include season/week, so a previous week's slow job cannot masquerade as the next week's creation result.
- Existing linked channels are fetched fresh and shared thread links fail closed instead of editing another game's thread.
- Staff reports provide **Review & Advance Week** and refer staff to `/games create`. Legacy repair buttons direct users to the command. Creating threads does not approve results or advance a week.

## Preserved behavior and recovery limits

Saved results, screenshots, extractions, permanent game IDs, submissions and history survive repairs and explicit thread replacement. Normal weekly advancement does not delete conversation history; old threads retain Discord's existing inactivity archival behavior. `/games cleanup` remains an explicitly confirmed deletion tool.

A transport timeout can mean Discord created a thread but lost its response. Such a creation stays marked pending, preventing duplicate threads. Staff must identify the actual thread and link it through `/game setup` before retrying. The audit does not guess by thread name or delete unlinked threads. External deletions of otherwise healthy saved threads can be repaired immediately with `/games create`.

## Verification

Regression coverage includes all 15 weeks with the actual creator and advancement services (210 distinct game threads), repeated creation and confirmation, clock preservation, manual retry after partial creation/restart, intentional cleanup, destructive replacement confirmation, authorization, stale staff controls, and a week change while Discord creation is suspended. Existing cleanup, season-start and command-schema checks also pass.
