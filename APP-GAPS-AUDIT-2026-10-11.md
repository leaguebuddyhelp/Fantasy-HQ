> Updated October 17, 2026: the separate free agency offer/waiver workflow described in this historical document has been retired. See [Roster reconciliation](ROSTER-RECONCILIATION.md) for the current process.

# Additional application gaps — October 11, 2026

Subsequent repair status: all five findings now have local fixes; see [repair details and verification](APP-GAPS-REPAIRS-2026-10-11.md). The findings and reproduction results below describe the original audited behavior.

Five additional defects reproduced in the current local working tree: one P1, two P2, and two P3. No new P0 was established. This is a targeted follow-up audit, not a new production readiness certification.

Application source, existing pending repairs, live league records, Discord messages and deployment settings were left unchanged. Only this report and audit evidence were added. The season-phase changes already present locally are included in the audited snapshot; their production deployment was not verified in this pass.

## GAP-01 — P1: expired trade responses can advance the trade

Locations: [GM decisions](src/fantasyhq/trade-service.js:315), [counters](src/fantasyhq/trade-service.js:350), [committee votes](src/fantasyhq/trade-service.js:371), [Discord handlers](src/fantasyhq/discord-trades.js:580).

The mutation methods check status/version but do not check the persisted response deadline. Discord handlers also do not enforce that deadline before invoking them. Expiration depends on `expireDue` running separately. Proof submission already checks its deadline directly.

**Reproduced:** advance the fixture clock to 24 hours plus one millisecond without running the sweep. A GM approval advances to PENDING_COMMITTEE; a counter returns the trade to DRAFT; an expired committee approval advances to AWAITING_PROOF and creates a fresh proof deadline. These are three independent probes.

**Impact:** coaches or committee members can act after the stated cutoff between sweeps, or longer when reconciliation is delayed. This defeats the advertised deadline and can restart an expired workflow. This is distinct from intentionally allowing a timely Week 9 proposal to finish after the league trade deadline.

**Repair:** enforce response expiration inside each mutation before recording a decision or counter. Share the expiration policy with the sweep and preserve the audit trail. Keep timely submitted proof eligible for later Staff review. Add before/exactly-at/after-deadline tests that do not call the sweep first.

## GAP-02 — P2: one missing Discord news post blocks later articles

Location: [Discord news reconciliation](src/fantasyhq/discord-news.js:8).

All published stories are processed in one loop without per-story error handling. Fetching an old deleted message raises Discord's Unknown Message error and aborts the loop before later articles are delivered. The null-message branch also throws. Subsequent sweeps encounter the same persisted reference again.

**Reproduced:** store an older published article with a deleted message reference followed by an undelivered published article. Mock Discord error 10008 on the first fetch. Reconciliation rejects and sends zero messages for the later article.

**Impact:** Discord news delivery can stall persistently after an old post is deleted, even while the website has published articles. This is a demonstrated failure path, not evidence that a production post has been deleted.

**Repair:** isolate article delivery errors, retain the original publication receipt/history, flag the missing post for Staff, and continue processing other stories. Handle deleted-message, permission and transient failures distinctly. Do not silently erase publication history or repeatedly recreate posts.

## GAP-03 — P2: historical news misses subsequent stat corrections

Locations: [news source season selection](src/fantasyhq/news-service.js:11), [change detection](src/fantasyhq/news-service.js:61).

Sources and revalidation are limited to the active season. Public and Staff news lists retain historical stories, but a stored correction to an older season's box score does not produce a pending corrected source or correction notice for its article.

**Reproduced:** generate, approve and publish a Season 1 article containing 13 rebounds. Switch the active league to Season 2, persist a correction to 20 rebounds in the original game's player stats, and run detection. The historical article still says 13 rebounds with no revalidation flag or pending source.

**Impact:** archived news can contradict corrected official records. The reproduction changes the historical record directly through the submission store; it does not exercise a live Staff correction interaction.

**Repair:** revalidate articles referencing a corrected game in its own season, preferably through targeted source invalidation rather than scanning all historical seasons every minute. Preserve publication dates and revisions, and require Staff review of corrected prose. Add a correction-after-rollover regression.

## GAP-04 — P3: opening an FA period ignores its duration argument

Location: [offseason stage creation](src/fantasyhq/offseason-free-agency.js:29); reachable through the [admin API](src/web.js:394).

`stageAction` accepts and validates `hours`, but opening a stage hardcodes 24 hours. Extending a period uses the supplied duration correctly.

**Reproduced:** `{action:'open', hours:6}` creates a deadline 24 hours away.

**Impact:** callers supplying a custom opening duration receive an unexpected deadline. The current website submits 24 hours, so its ordinary opening button is unaffected.

**Repair:** either honor `hours` on open or explicitly constrain/document opening periods as 24 hours and reject other values. Test the actual persisted deadline, not just successful stage creation.

## GAP-05 — P3: retired players appear as selectable free agents

Locations: [offseason inspection](src/fantasyhq/offseason-free-agency.js:24), [Discord player browser](src/fantasyhq/discord-offseason-free-agency.js:5).

The inspection list filters by stage eligibility without excluding `retiredAt`. The draft/offer mutation separately rejects retired players via `player()`. Thus the UI can offer an action that immediately fails.

**Reproduced:** in STAGE_2, mark an otherwise eligible unrostered 85 OVR player retired. The coach inspection still lists the player; selecting the same ID for an offer draft fails with “Choose a stored active player.” No retired-player signing bypass was found.

**Repair:** share active-player eligibility between the list, draft and submission paths. Confirm retired players are absent from every open-stage selector while remaining visible in historical records.

## Verification and repair order

- **46 existing tests passed** in a temporary source snapshot excluding `.env`, live `data`, Git metadata and reports. Covered trade services and Discord handlers, news service/delivery, offseason FA, roster phase locks, and season-specific boards.
- **Seven audit probes reproduced the five defects.** The probes assert the observed broken behavior; their passing result means reproduction succeeded, not that the defects were repaired. They belong in audit evidence, not the application regression suite unchanged.
- Evidence: [reproduction probes](reports/gaps-audit-2026-10-11/reproductions.cjs), [probe results](reports/gaps-audit-2026-10-11/reproductions.log), [existing test results](reports/gaps-audit-2026-10-11/focused-tests.log). These audit artifacts are untracked; no commit or push was made.
- Priority: enforce trade deadlines first; isolate news delivery failures second; implement historical news invalidation third; then fix FA duration and retired-player list consistency. Convert each probe into a desired-behavior regression during repairs.

No full-suite, browser, real OCR-image, Railway, or live Discord acceptance run was performed in this follow-up. The last broader local suite is recorded separately in [phase-lock repairs](PHASE-LOCK-REPAIRS.md). Previously reported production roster, deployment reproducibility and operational verification concerns are not recounted as new findings here, and their current live status was not rechecked. No new readiness percentage is justified by this targeted pass.
