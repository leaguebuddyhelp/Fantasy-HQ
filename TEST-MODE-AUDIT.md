# Test Mode audit — October 6, 2026

Scope: Discord command deployment/routing, setup and ownership, rosters/website Admin, regular-season scheduling, private game threads, screenshot extraction/review/finalization, official statistics, trades, player upgrades, scouting, and regular/live mock drafts. Existing working-tree changes were preserved.

## Findings and changes

| Finding | Resolution |
| --- | --- |
| Test Mode mostly allowed vacant teams; two distinct screenshot submitters still blocked solo game credit | Explicit staff-only `Test as [team]` controls collect both scheduled sides using one real account; same images/extraction/validation/stats pipeline as normal games |
| An existing matchup card could retain old controls after upgrading the app | Active-week activity refresh updates current matchup classification and card version; existing thread/message reused |
| Two-coach finalization rejected a legitimate authorized solo submission | Finalizer permits one uploader only when current explicit Test Mode, recorded solo authorization, matching team participants and current ownership all agree; otherwise normal distinct-uploader requirement remains |
| Normal leagues with `requireAllOwners:false` were treated as test leagues | Only `settings.testMode === true` enables test matchup behavior; online vacancies use CPU classification |
| Host could not exercise human selection for other vacant teams | Opt-in staff host solo control supplies the human pick flow for vacant teams; actual owned teams remain under their owners; real host identity and test-control flag persisted |
| Removing staff/test permission or assigning an owner could leave a stale solo path | Upload, extraction finalization, pick confirmation and periodic mock processing recheck applicable permission/mode/ownership; tests cover ownership changes and disabled mode |
| Solo tester holding committee role was excluded as an involved coach, leaving no eligible reviewers | Virtual five-reviewer fallback activates when there are no independent real voters; any independent real committee remains real |
| Test Mode could weaken owner authorization on trades | Owned teams always require their current coach for submit/respond. Discord staff simulation is restricted to vacant counterpart teams; uninvolved non-staff cannot submit proof using a generic Coach/GM role |
| No explicit editable Test Mode command option | Added `/league settings test_mode` under existing staff and SETUP-phase protections; settings card labels the mode |
| Testing guide described outdated/missing workflows and old counts | Replaced with ordered walkthrough of implemented Discord and website flows, including solo upgrade credit, failures, recovery, and normal online acceptance |

## Isolation and online compatibility

Solo behavior requires an explicitly enabled test league. It is not enabled by vacancy permissions, staff role alone, or a mock session flag alone. One tester still owns only one actual team. Solo controls do not reassign ownership, manufacture official scores, grant arbitrary scouting/upgrade credits, or bypass roster, trade, phase, extraction and final-game validation. Test results are persistent within the test league and intentionally affect its standings/statistics.

Existing multiplayer regression tests use distinct owner identities. New tests cover single-account team-side collection via service and Discord adapters, rejecting stale ownership/mode/permissions, exact validated solo scores/player lines/DNP handling, normal vacant-league CPU classification, virtual versus real committee routing, protecting real trade owners, and solo live buttons/pick confirmations with real host identity. Tests run on temporary fixtures; actual Discord privacy/delivery on another user's device still needs the optional two-person acceptance pass in the guide.

## Remaining product limits

A solo account cannot visually inspect another user's Discord client. Closed DMs can prevent recap delivery; the mock retains delivery failure/retry state. Accurate OCR requires suitable screenshots and may need website correction/review. Four genuine scheduled final games remain required for earned upgrades; staff two-image submissions do not count as two-coach credit. Week force-advance is explicit and audited, and does not invent missing results.

The configured game-deadline field is stored/displayed, but active-week thread creation currently uses a fixed 48-hour clock. Result-confirmation and commissioner-approval fields are stored/displayed without separate configurable post-game approval workflows. Protected game-thread/week/cleanup APIs exist, but the website currently lacks dedicated buttons for them; manual testing uses Discord and read-only API checks.

Playoff settings are present, but a playoff bracket/game simulation engine and execution of a real draft from mock selections are not implemented. NBA 2K gameplay remains external. These are product scope gaps, not authorization paths to bypass.

See [TESTING-GUIDE.md](TESTING-GUIDE.md) for the complete manual procedure. Final validation: `npm run check` passed all **316 tests**, syntax checks and TypeScript checks; `git diff --check` passed. Registered all 20 Discord commands and restarted the local app. Runtime confirmed bot login, 30/30 team emojis, website health HTTP 200, draft-class API HTTP 200, and unauthenticated week-admin API HTTP 403. Check log: `/private/tmp/leaguebuddy-solo-final.log`. No test league was created/rebound and no gameplay results were fabricated during validation.
