# Regular-season weekly dashboards

## Coach dashboard

Open **My Week** on the website and choose a team. The choice is remembered on that browser; links from Discord preselect the correct team. The public view shows this week's opponent or bye, deadline, game date, received box-score count, approval state, next step and Discord shortcuts. Changing teams clears the previous team's view before loading. Reloads do not overlap; the selected view refreshes once a minute while its section is open.

In Discord, use `/myteam` → **MY WEEK**. The panel is ephemeral and rechecks the current configured team role against owner records on every refresh. It includes only that team's active trades, FA offers and pending waiver requests, plus the existing My Active Offers flow. Trade responses and winner roster-cut work are flagged. Shared Coach/GM roles alone do not identify a team. The public website has no coach login, so private transaction details remain in Discord and the protected Staff website checklist.

## Weekly Staff report

One embed is posted in the existing configured Staff channel for the active week. It refreshes once a minute when the reported data changes; unchanged reports are not edited. On confirmed advancement, the prior report is marked CLOSED and its advancement button is removed, then a new message is posted for the next week. Startup recovers existing message receipts, and a deleted current report is replaced. Closed reports are retained. Week 15 closes its report without creating Week 16 or starting playoffs.

The report contains:

- CPU vs CPU, user vs CPU and user vs user: total games, approved games and remaining games. These are counts, not a full matchup list.
- Current week deadline and overall approval progress.
- Unfinished games, missing threads, missing game dates and incomplete box-score pairs.
- Box scores awaiting review, OCR failures, processing work and duplicate game records.
- User matchups with no recorded coach activity and the two bye teams.
- Active trades grouped by coach response, committee voting, proof upload and Staff proof review.
- Active FA offers, offer proof reviews, active windows, winner roster cuts and pending waiver requests.
- A Website checklist link and the existing Staff-only week-advance preview/confirmation.

Classification uses current assigned coach ownership even in Test Mode. This is a report classification only: Test Mode's existing game-submission rules remain unchanged. Approved completion uses the same official-game eligibility check as week advancement. An unvalidated `FINAL` marker does not count as approved. Reports show live operational progress; standings and player/team stats remain published only when the week advances.

Unfinished games block normal advancement. Pending transactions are reminders and do not add advancement restrictions. The current implementation has **waiver requests for player releases**, not a separate competitive waiver-claim queue; the dashboard labels the existing workflow accurately.

The Staff channel is checked for privacy before any report is posted or edited. It must exclude everyone and non-Staff roles/member overrides, apart from the bot and administrators. A permission problem is logged rather than publishing private work in a coach-visible channel. No role pings are sent on refresh.

## Website Staff checklist

Unlock the existing Commissioner view with the website admin key. During the regular season, **Weekly Staff checklist** shows the same three matchup totals, game closeout queue and pending transaction queue. Game rows link directly to the private thread and, where an extracted review is available, the existing website review page. Processing/failed OCR work leads back to its thread for recovery. Transaction rows link to their existing Discord workflows.

The Staff report link opens the current Discord report for week-advance confirmation. This keeps the established confirmation and force-advance rules in one flow. Old report buttons cannot advance a later week or a newly bound season. Website requests to `/api/league/admin/weekly` require the existing admin authorization; public `/api/league/weekly/:teamId` responses omit transactions, offer amounts, proof images and private review links.

## Persistence and testing

Message receipts live in the league's existing `settings.json`, keyed by guild, season and week ID. Receipts preserve unrelated settings. Concurrent publishers share an in-process lock, sends use a stable Discord nonce, and lost receipts are recovered from a stable report footer. Closing a prior week refreshes its game counts and preserves its last active transaction totals; afterward that message is a frozen record.

Regression coverage includes ownership-based totals in Test Mode, official completion eligibility, missing submissions, OCR/review states, team-specific transaction filtering, public API privacy, Staff authorization, repeated reloads, stale advancement controls, restarts, deleted messages, lost send receipts, week rollover, Week 15 completion, HTML escaping and mobile layout. Tests use isolated leagues and mocked Discord delivery; no live game results, offers, waivers or week transitions are simulated.

Final local validation: `npm run check` passed **432 tests, 0 failures**, including syntax checks, TypeScript, OCR/photo tests and the dashboard regressions. Log: `/private/tmp/leaguebuddy-weekly-validated.log`. The focused dashboard/core suite and mobile browser checks also passed.

Live deployment `7396d9be-e1a6-48c0-abd5-d887e1505aea` succeeded. Week 2 Staff report: https://discord.com/channels/1516463916933189742/1556644589299826690/1557523776718118925 . Read-only verification found one embed with CPU vs CPU 0/12 approved, user vs CPU 1/2 approved and user vs user 0/0. The live protected endpoint returns 403 without Staff authorization and 200 with it; public coach responses omit transactions. Live desktop (1440px) and mobile (390px) checks found no JavaScript errors or horizontal overflow. The Lakers dashboard shows the approved Warriors matchup and the correct Oct 30 game date. The existing league remains on Week 2 with Test Mode and the 60-second FA clock unchanged. Screenshots: `/private/tmp/leaguebuddy-weekly-live-1440.png`, `/private/tmp/leaguebuddy-weekly-live-390.png`.
