# Repairs for the October 11 application audit

All five findings in [the audit](APP-GAPS-AUDIT-2026-10-11.md) have local repairs. Existing pending changes were preserved. Nothing was deployed, pushed, or changed in live Discord/league data.

| Finding | Result |
| --- | --- |
| GAP-01: expired trade responses | GM approval/denial, counters and committee votes enforce the persisted deadline directly. The same expiration policy serves the background sweep. An expired response records the existing expiration transition and rejects the action, without adding a vote or starting a fresh window. |
| GAP-02: deleted news post blocks delivery | Each story's delivery failure is isolated. Original publication references remain intact; later articles continue. Staff News Review displays a persistent delivery alert distinguishing missing posts, permission failures and retryable errors. Successful delivery clears the alert. Repeated identical failures do not create duplicate audit entries. |
| GAP-03: historical news misses corrections | Detection revalidates tracked historical performance stories in their original season when source fingerprints change. Fingerprints include game records, players, memberships, schedule and postseason state. Unchanged archives skip repeat aggregation. Changed prose still requires Staff approval; original dates and revisions remain intact. No new historical performance drafts are generated. |
| GAP-04: FA duration ignored | Opening an offseason FA period now honors its validated `hours` argument. The website's normal 24-hour action retains its duration. |
| GAP-05: retired FA players listed | Shared eligibility excludes retired players from offseason selectors as well as offer validation. Historical player records are retained. |

Regression coverage includes independent late GM/counter/committee actions; one millisecond before, exactly at, and after response deadlines; single expiration audit entries; continued news delivery without duplicate posts; missing-message, permission and transient failures and recovery; historical correction review after rollover; exact FA opening/deadline behavior; and retired-player selection rejection.

Tests use temporary league storage and mocked Discord calls. Production delivery, live user interactions, and Railway deployment remain unverified by these local checks. A deleted original news post is flagged for Staff review; the bot does not silently recreate it or discard its history.

Verification results are recorded in [the repair evidence directory](reports/gap-repairs-2026-10-11). The original audit reproduction probes intentionally assert the old broken behavior and are retained as historical evidence, separately from the desired-behavior regressions in [app-gap-regressions.test.js](test/app-gap-regressions.test.js) and [news-discord.test.js](test/news-discord.test.js).

- `npm run check`: **680 tests passed, zero failures**, including syntax/TypeScript checks, browser tests, and the full season/postseason/offseason simulation. See [full results](reports/gap-repairs-2026-10-11/full-check.log).
- After adding schedule/postseason state to historical source fingerprints, **19 final focused tests passed**, covering the repaired scenarios and news generation/delivery/analysis. See [final focused results](reports/gap-repairs-2026-10-11/final-news-regressions.log). These overlap the full suite and are not 19 additional unique tests.
- `git diff --check` passed. Tests ran in isolated snapshots without `.env` or live league data. No deployment or live Discord acceptance was performed.
