# App simplicity audit — October 5, 2026

Reviewed Discord setup and schedule controls, season start, game-thread controls, screenshot submission/review, website admin, roster management, advancement, cleanup and deletion.

| Flow | Finding and resulting behavior |
| --- | --- |
| Admin access | Moved above the tools it unlocks. Enter submits the key. Removed environment/configuration terminology from the user-facing instructions. |
| Initial admin loading | Unlocking, or opening with a saved key, loads channel choices, game status, cleanup weeks and the selected roster automatically. Active-week status loads during the regular season. Refresh buttons remain for retries. Loading never creates or deletes anything. |
| Commissioner identity | One name field for week advancement and cleanup; shares the existing session value with submission review. No duplicate name fields in each panel. |
| Rosters | Selecting a team opens its roster immediately. A slower previous request cannot replace the newly selected team's roster. Refresh remains available. |
| Thread creation | The primary action saves the selected Games channel, then creates missing threads. No separate save click is required. If channel saving fails, creation does not run. Saving a channel alone remains available. |
| Season start | Website wording now makes clear that Start season already validates readiness. Separate Check readiness is optional. Added progress feedback and disabled duplicate start clicks; refresh relevant admin information after starting. |
| League setup | Already creates roles/channels, imports rosters and syncs owners. Retained the setup checklist as the main path; updated empty-schedule guidance to point there instead of three separate commands. |
| Schedule confirmation | Retained preview and confirmation because regeneration replaces the schedule. Existing commands remain available for recovery. |
| Screenshot submission | Already processes after both images arrive. Retained staff submission for any matchup and stored-image retry so users need not upload twice. |
| Submission review | Retained separate save/revalidation and approval: users must see unresolved numerical problems before official stats change. Existing player/stat links and local save feedback reduce navigation. |
| Week advancement | Already starts the next week and creates its threads together. Retained confirmation and separate force action for unresolved games. |
| Cleanup and deletion | Retained explicit previews/confirmation because they permanently remove Discord threads or stored league data. Cleanup remains separate from advancement so unfinished submissions aren't silently removed. |

Validation: mocked browser tests cover automatic read-only loading, Enter-to-unlock, one shared name, roster selection races, combined channel save/thread creation, and failure handling. No live Discord actions or league mutations were performed during the audit.

## Cross-surface usability verification — October 5, 2026

- Website smoke checks passed for commissioner unlock/roster loading and screenshot review, including issue navigation, image zoom, correction retries, approval feedback, and mobile layout.
- Player Stats, Team Stats, and mock-draft browser/service tests passed. Discord schedule layout, command registration, trade-builder navigation, package review, and player paging tests passed.
- Live website checks at 1440px and 390px showed no horizontal overflow or JavaScript errors; visible league and team assets loaded.
- `npm run check` passed all 260 tests. Focused follow-up passed all 55 mock-draft and stats-page tests.
- No live Discord messages, real league mutations, or command deployment were performed. Discord rendering, permissions, DMs, and end-to-end interaction in a real server remain for the live checklist in [MOCK-DRAFT-TESTING.md](MOCK-DRAFT-TESTING.md).
