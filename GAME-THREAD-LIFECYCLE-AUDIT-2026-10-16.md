# Weekly game-thread lifecycle audit — October 16, 2026

## Weekly routine

1. Start the regular season after roster/schedule validation. Week 1 becomes ACTIVE. The recovery loop creates its 14 private matchup threads automatically; `/games create` does the same immediately.
2. The first successfully obtained Discord thread starts the shared 48-hour clock. Every matchup receives that deadline. Retries, repairs and explicit replacements preserve it.
3. Coaches use their matchup thread to arrange the game, set its 2K date, submit a Streamlink and upload both box scores. Only the participating coaches and league staff receive private-thread access. Approval remains separate from thread creation.
4. Staff use **Review & Advance Week** or `/week advance`. Normal advancement requires all 14 scheduled games to have valid approved results. Force advancement remains an explicit confirmation and records unfinished games without fabricating results.
5. Confirmation publishes the completed week's stats/standings, activates exactly one next week, creates its 14 threads, and refreshes the weekly announcement/report. The same routine repeats through Week 15; there is no Week 16. Playoff seeding is a separate confirmation.

## Repaired findings

- `/games create` previously required deleting/replacing every existing thread. It now creates missing threads and repairs/reuses existing ones. Destructive replacement is available only through `/games create replace:true` and its existing confirmation.
- A committed week activation followed by a Discord failure could leave missing threads until staff retried manually. The startup/minute recovery loop now retries incomplete current-week creation, including missing control messages. It also launches Week 1 consistently. Intentionally cleaned threads and inactive/completed/simulated seasons are excluded.
- Creation captured a schedule before awaiting Discord/ownership operations and could write it after another operation changed the active week. It now rechecks league/season/week before continuing and updates the latest schedule when starting the clock. Creation locks include season/week, so a previous week's slow job cannot masquerade as the next week's creation result.
- Existing linked channels are fetched fresh and shared thread links fail closed instead of editing another game's thread.
- Staff reports now distinguish **Create / Repair Threads** from **Review & Advance Week**. Creating threads does not approve results or advance a week.

## Preserved behavior and recovery limits

Saved results, screenshots, extractions, permanent game IDs, submissions and history survive repairs and explicit thread replacement. Normal weekly advancement does not delete conversation history; old threads retain Discord's existing inactivity archival behavior. `/games cleanup` remains an explicitly confirmed deletion tool.

A transport timeout can mean Discord created a thread but lost its response. Such a creation stays marked pending, preventing duplicate threads. Staff must identify the actual thread and link it through `/game setup` before retrying. The audit does not guess by thread name or delete unlinked threads. External deletions of otherwise healthy saved threads can be repaired immediately with `/games create`.

## Verification

Regression coverage includes all 15 weeks with the actual creator and advancement services (210 distinct game threads), repeated creation and confirmation, clock preservation, partial creation/restart recovery, intentional cleanup, destructive replacement confirmation, authorization, stale staff controls, and a week change while Discord creation is suspended. Existing cleanup, season-start and command-schema checks also pass.
