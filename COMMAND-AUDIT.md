# Discord command and embed audit

The current menu has 22 top-level commands. Eight registered actions were removed; their old handlers remain to avoid abruptly breaking existing interactions during deployment. Apply the menu with `npm run deploy:commands` and restart the bot for embed changes.

## Removed from the menu

| Removed action | Replacement / reason |
| --- | --- |
| `/league status` | `/league setup` is the same dashboard |
| `/admin status` | `/league setup` already shows league progress |
| `/roster status` | Setup checklist already checks roster coverage |
| `/setup activate` | Enter preseason button on the validated setup checklist |
| `/schedule confirm` | Confirm schedule button attached to the preview being reviewed |
| `/schedule regenerate` | Regenerate button on that preview |
| `/ratings freeagency` | `/freeagents` is the league-facing available-player list |
| `/admin season` | Hidden until a complete season-transition workflow exists |

## Kept deliberately

- `/schedule preview` recovers a pending preview if its original message is lost.
- `/schedule full` exports the entire schedule; readable embeds are for browsing.
- `/ratings player`, `/ratings team`, and `/ratings top` expose the original snapshot for comparison with edited league records.
- `/roster import`, `/roster freeagency`, `/league roles`, and `/admin bind` provide recovery paths when automatic setup is incomplete.
- `/myteam` is a personal summary; `/team roster` can inspect another team, and `/schedule mine` includes every week.
- Ownership remains automatic; no manual sync command was reintroduced.

## Embed changes

- Shared yellow accent, readable phase labels, bold names, short descriptions, and small information groups.
- Saved weekly schedules show East/West matchups and byes without monospace code blocks.
- Team schedules split all 15 weeks into three sections and avoid repeating the team's own name on every line.
- Generated previews retain all 15 pages, navigation, and staff-only mutation buttons tied to the exact pending schedule.
- Team directories group by conference; owners use Discord mentions and unclaimed teams say Open.
- Team rosters include player names, OVR, position, and jersey with spacing. Removed roster memberships no longer appear.
- My-team and ratings rosters split long fields instead of cutting off players.
- Ratings team cards use the team logo and a compact snapshot footer; the redundant automatic text attachment was removed.
- Rankings and free-agent lists use bold names and separation between players.
- Creation and settings embeds were shortened; source player and draft prospect cards retain their photos and compact details.
- Deletion remains an explicit private confirmation, rather than a decorative card that obscures its effect.

Validation covers command registration, all 15 schedule pages, saved schedules, long list field limits, and the existing league/permissions workflows. Live Discord rendering should still be checked after restart.

## Game screenshot collection

- `/game setup week:<number> team:<name or abbreviation>` links an existing private thread and posts Submit Game. Staff only; no thread creation.
- See [Game submissions](GAME-SUBMISSIONS.md) for testing and storage details.

Active-week addition: `/games create` previews and confirms replacement of every private thread for the ACTIVE regular-season week. It works regardless of game/submission status, preserves saved game records, screenshots, stats and submission history, and warns that unsaved Discord-only messages are lost. `/games cleanup week:<1–15>` remains the confirmed delete-only action for any scheduled week.

Regular-season addition: `/standings` shows both conference tables; optional `conference: East` or `West` narrows the display. Read-only and available to league members. All records derive from official finalized regular-season games; no standings-edit commands exist.

Regular-season addition: `/week advance` previews completion and requires a confirmation button. Optional `force:true` previews closing unresolved matchups without assigning results. Existing league staff permission checks apply to both the command and confirmation. Week 15 completes the regular season without creating Week 16 or starting playoffs.

Completed-week addition: `/games cleanup week:<1–15>` previews private Discord threads and requires **Cancel / Delete Threads** confirmation. Existing Commish, Assistant Commish or Manage Server checks apply to both steps. ACTIVE and UPCOMING weeks are rejected; no force option exists. Confirmation binds the commissioner, server, league, season and exact Game/thread IDs and expires after five minutes. No new top-level command group is added.

The existing website Admin area exposes the same service under **Completed-week thread cleanup**, protected by the existing commissioner key and entered audit name. Requested and completed cleanup events use the existing audit log. Original thread IDs and creation times remain on Games; cleanup adds timestamps, commissioner and DELETED/MISSING outcome. No permanent game history is removed.

League setup now provisions 17 `lb-` channels, including the read-only Player Upgrades ledger, and the `LEAGUEbuddy Trade Committee` role during `/league create`. Existing leagues can use `/league setup` → **Create / repair channels**; commissioner permissions are checked at the button. `/league roles` now repairs 34 roles (30 teams plus four league roles). The channel action reapplies defined channel access, preserves saved IDs/names/locations, creates missing channels, and reports partial failures for retry. Committee members have no commissioner privileges. See TESTING-GUIDE.md for channel access details.

NBA application emojis are loaded by name from the connected bot's application at startup. The 30 supplied names decorate Discord schedule previews, weekly/team schedules, standings, team directories, branded roster/team cards, matchups, screenshot instructions and processed score summaries. Team names remain alongside emojis. Existing website logos, autocomplete values, channel/thread names and stored team IDs remain unchanged. Startup reports missing emoji names; API failures leave readable text. Emojis must belong to the application used by the bot token. Restart to reload added/replaced application emojis.

### 2026-10-05 — Submission review guidance and all-week thread cleanup
- Review UI now identifies team/player/stat, links warnings to table fields, explains commissioner-name requirements, and shows save/error/approval feedback beside actions. Original image and stat-table layout retained.
- Weekly cleanup accepts any scheduled week regardless of completion; existing authorization, confirmation, channel validation, history retention and retry behavior retained. Thread creation skips intentionally cleaned games.
- Updated website/Discord cleanup wording and testing guide. No live threads deleted or saved league data changed.
- Validation: `npm run check` passed all 148 tests; mocked Playwright browser check passed name validation, stat navigation, acknowledged warnings, rejected/successful saves, approval availability, original images and mobile rendering.

### 2026-10-05 — Permanent league archive cleanup
- League deletion now stages and removes all game-history directories whose record matches the league ID, across all seasons, along with league configuration. Includes originals, extracted/corrected box scores, submission history and game stats.
- Rechecks archive membership at confirmation; preserves other leagues and shared assets. Failed unbinding restores league and archive directories. Unsafe or unreadable archive records block deletion before mutation.
- Discord confirmation and README now describe the expanded deletion scope. Discord server objects remain unchanged. No live league deletion performed.
- Validation: deletion tests passed, including multi-season cleanup, other-league preservation, late archives, rollback and unsafe records; full npm run check passed.

### 2026-10-05 — Simplicity audit
- Audited setup, scheduling, season start, submissions/review, rosters and admin cleanup/deletion; findings in SIMPLICITY-AUDIT.md.
- Consolidated admin loading after unlock, commissioner identity, roster selection/loading and Games-channel save/thread creation. Moved admin access above actions, enabled Enter-to-unlock and clarified built-in season-start validation. Read-only loading never changes Discord or league data.
- Preserved destructive confirmations and explicit game approval. No live Discord actions performed.
- Validation: npm run check passed all 151 tests. scripts/admin-simplicity-smoke.js passed mocked browser tests for read-only loading, shared identity, roster request races, combined channel/create sequencing and failed configuration.

### 2026-10-05 — Game-date gate and visible approval receipt
- Added Set game date modal with MM/DD/YYYY example, strict calendar validation, matchup-owner/staff authorization, persistent change history and bold matchup-card date. Other matchup buttons stay hidden until a date is saved; stale buttons/uploads are gated too. Date editing is blocked after finalization. Activity-card signatures refresh old active cards after restart.
- Website approval now opens a confirmation dialog immediately after server success, disables repeat approval and shows APPROVED. Successful approval remains acknowledged if subsequent page refresh fails; rejected approvals do not show success.
- Covered date access/validation, solo staff/CPU, button gating, staff submission/cancel, both forfeit targets and CPU; existing coach submission, fair-sim and retry tests pass.
- Validation: npm run check passed all 154 tests; mocked review browser test passed successful/rejected approval and confirmation dialog behavior. No live Discord messages or game records modified during testing.


### 2026-10-07 — General usability audit

The current exported menu contains 22 unique commands; the retired definitions above are still filtered out before registration. See [APP-USABILITY-AUDIT.md](APP-USABILITY-AUDIT.md) for the current command map, flow findings, implemented fixes and remaining recommendations. Current channel setup creates 18 channels and provisions 35 roles (30 teams, Coach, GM, Trade Committee and both commissioner roles).
