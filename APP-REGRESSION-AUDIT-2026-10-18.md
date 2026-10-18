# App regression audit — October 18, 2026

## Scope and production evidence

Read-only inspection of production deployment `97b4607b-dc57-4e3a-8e6d-fefd9d8b35c8`, source history since October 16, bot logs, 17 public website/API endpoints, unauthenticated admin access, and desktop/mobile browser startup. League transactions were not performed as part of the audit.

The reported breakage has a shared response/performance component. The health endpoint returned 200 while commands expired and pages waited for data. Health alone did not establish that the app was usable.

Production snapshot: Season 1, regular season, Week 1; 30 teams, 652 unique player IDs, all rosters at 14–15 players, 28 assigned owners, and 210 scheduled games. The active board returned 75 prospects and correctly withheld prospect stats during the regular season. Published player GP was zero; publication remains tied to week advancement. This inspection found no evidence of a roster or schedule wipe.

## Findings and repairs

| Priority | Finding | Evidence | Repair |
| --- | --- | --- | --- |
| Critical | Initial Discord responses lacked consistent protection from main-thread/network delays. | `/team` callbacks failed with code 10062. A defer took 3295 ms and reached interaction age 4062 ms. Separate latency probes measured REST round trips up to 4353 ms. | All slash commands acknowledge early. SDK JSON callbacks for replies, updates, autocomplete, and modals use the existing independent transport worker. Preserve the SDK's serialization, error and rate-limit handling; multipart files retain SDK transport. Recruitment commands retain public visibility and coach commands remain private. |
| High | Autocomplete fallback retried expired callbacks. | Several autocomplete handlers catch a failed response and send another empty response. | Suppress repeated expired/already-acknowledged callbacks within the interaction wrapper. |
| High | Browser owner-label polling rebuilt/downloaded the entire league every ten seconds. | `refreshOwnerLabels()` requested `/api/league-site`, approximately 1.17 MB uncompressed, per visible browser tab. | Add a small ownership endpoint and poll that endpoint instead. Continue detecting season and phase changes. |
| High | Schedule reads rebuilt all full rosters, stats, needs, valuations and picks. | `/api/league/schedule` returned approximately 1.45 MB and took 23078 ms in the initial smoke test. | Return schedule plus team identifiers/names only. Schedule generation and matchups are unchanged. |
| High | Home-page team summaries used the expensive full team-detail builder. | `leagueSitePayload()` called `listTeams()` before discarding roster/pick/stat details. | Add a summary path using current memberships and owners, without player-stat or trade snapshots. |
| High | Large JSON responses were uncompressed. | Players response approximately 1.11 MB; team directory approximately 1.43 MB. Both returned 200 but some requests took over 20 seconds. | Asynchronously gzip eligible JSON responses when the client supports gzip; retain `no-store` and vary by encoding. |
| High | A slow/failing league or draft request blocked both startup views. Requests had no deadline. | Real browser remained on loading indicators during the startup observation window without a JavaScript exception. | Load league/draft independently, add a 20-second request deadline, and replace indefinite loading with a retry message. |
| High | Default 1,000-draft generation ran on the bot's main event loop. | Simulation code computes ten full drafts between event-loop yields; a yield does not move computation off-thread. | Compute the default simulation in a worker. The owning process retains validation, stale-season checks, writer lease, and atomic publication. Failure preserves the last published snapshot. |
| Medium | Continuous diagnostics added synthetic CPU work and extra Discord requests. | Every 15 seconds the bot ran a 20-million-iteration benchmark plus DNS and REST probes. | Remove the active probes; retain interaction timing, event-loop and background-job diagnostics. |
| Low | Coach-facing website copy still referenced removed offer/waiver workflows. | My Week description advertised private offers/waivers after their removal. | Update copy to the current trade workflow. |

Initial public API smoke test: 17 successful responses; the unauthenticated admin-session check returned the expected 403. Successful responses did not imply acceptable latency. The observed times include network/transfer time and are not isolated server CPU measurements.

## Local performance comparison

A temporary repository reconstructed from the public production roster/schedule responses was used without touching production storage. On this machine, full team-detail construction took 220 ms versus 35 ms for the new summaries (30 teams). Full detail serialized to 1,475,423 bytes versus 43,040 bytes for summaries. Gzip level 1 reduced the public player response from 1,113,524 bytes to 142,622 bytes. These are local measurements, not a promise of production network latency.

## Verification and limits

Regression coverage includes SDK callback payload types and errors, public/private slash visibility, expired autocomplete suppression, current roster summary membership, compact schedule/owner responses, gzip negotiation and data equivalence, worker failures, and independent league/draft startup in a browser. The complete `npm run check` passed: 709 tests, zero failures, including TypeScript/syntax checks and browser tests.

Existing tests cover trade/role permissions, roster report review and confirmation, roster corrections, game submissions/OCR, phase transitions, schedule, standings, and publication. Passing tests do not certify that an arbitrary new screenshot will extract correctly. No live signings, waivers, trades, week advancement, game creation or roster resets are used as smoke tests.

External DNS/Discord latency remains an infrastructure factor. Independent callback transport reduces the exposure to main-thread stalls; it cannot guarantee success if Discord delivers an already-expired interaction or the network exceeds Discord's response deadline. Monitor new deployment logs and real coach use after rollout. Do not restore retired free-agency flows or roll back roster data as a response to timing failures.
