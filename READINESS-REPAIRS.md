# Regular-season readiness repairs

Updated October 7, 2026. This document follows the historical findings in `REGULAR_SEASON_AUDIT.md`; that report describes the earlier code, not these repairs.

The reproduced P0/P1 failures have implementation fixes and regression coverage. Production signoff remains pending deployment and a real two-coach Discord rehearsal. A percentage cannot establish private-channel access, successful DM delivery, or recovery on the deployed volume.

## Your confirmed rules

- Eight playoff teams **per conference**. Ranking uses winning percentage, wins, head-to-head among tied teams, point differential, points scored, then stable team ID for otherwise identical ties.
- Upgrade progress comes only from verified **coach-submitted TEAM_SIDES**. Staff uploads of both sides do not earn progress, including human vs CPU games.
- Staff-approved forfeits record W/L and GP, with no fabricated scores, box scores or player statistics. Scoring and statistical averages exclude forfeits.
- Public standings/statistics publish when a week advances. Saved publication snapshots also keep later corrections from changing public numbers during the week. Staff closeout remains current.

## Repairs against the audit

| Finding | Implemented behavior |
| --- | --- |
| A001: corrupt storage erased | Invalid JSON, incompatible canonical collection types and unreadable files fail closed. Existing bytes are preserved. Role mappings also fail closed and now write atomically. |
| A002: departed-coach consent | Trades, offers and waivers check current owner/tenure before execution; ownership changes invalidate pending consent. Vacant-team Test Mode authority is explicit and cannot replace departed real-coach consent. |
| A003: missing season handoff | Confirmed, journaled playoff transition validates all 210 official results, preserves final standings and eight seeds per conference, publishes the final snapshot and closes upgrade spending. |
| A004: partial admin mutations | Admin player/roster edits and imports commit player data, memberships and audit records through a recovery journal. Movement/removal checks asset locks. Interrupted writes recover before subsequent reads. Upgrade invalidation also reconciles after missed callbacks. |
| A005: no correction/reversal | Staff can save and validate a correction while the existing result remains official, approve a replacement, reject an unapproved submission, or reverse an approval. Name/reason and prior result/statistics are retained. Upgrade credits are recalculated; already-spent credits produce visible debt rather than silently undoing applied player changes. |
| A006: nonofficial forfeits | Staff-approved forfeits are official administrative results. Coach concessions still need Staff approval. Completed matchup cards close their controls. |
| A007: malformed URL crash | Request exception boundary returns controlled errors. A real HTTP regression sends malformed input and confirms the next request succeeds. |
| A008: Staff-entered CPU games | Deliberately excluded from upgrade earning, per your answer. |
| A009: lost notifications | Upgrade notices have a durable outbox with attempts, retry backoff and successful-delivery receipts. FA failed DMs remain retryable. Staff reports show unresolved delivery failures. Correction/reversal updates prior approval messages. |
| A010: obsolete private access | Ownership reconciliation removes departed coaches, adds successors and preserves both Staff roles in saved private game threads, including completed weeks. Failed access repairs remain visible and retryable. |
| A011: one bad archive poisons all leagues | Archive scans return healthy records and expose individual storage failures without overwriting corrupt files. Missing/corrupt scheduled results cannot count toward closeout. |
| A012: multiple writers | Bot and standalone website acquire a filesystem writer lease. Repository/game/mock writes check ownership; offline commands cannot bypass a running writer. Supported mutation scripts acquire the lease too. |
| A013: no backup/restore | Startup, daily, before-advance and before-playoff backups; protected website backup button; offline backup/restore commands with SHA-256 verification and restoration into a new directory. Unchanged backup files share storage through hard links between snapshots, never with live files. |
| A014: admin identity/input | Bounded request bodies; query-string keys no longer authorize. Optional separate Staff keys bind the operator server-side and disable the legacy shared key. |
| A015: submitted trades cannot withdraw | Proposer/Staff withdrawal controls and service authorization; cancellation releases locks and stays in history. Submitted proof awaits Staff rather than expiring while in the review queue; Staff can approve, reject or cancel it. |
| A016/A017: legacy handlers/API routes | Retained compatibility helpers do not register extra slash commands. Protected APIs remain available for supported admin/recovery work. The website weekly checklist directs advancement through Discord. |
| A018: inconsistent publication | Website, pins, `/standings`, `/stats`, `/teamstats` and MyTeam use published scope. Public snapshot values stay fixed between advancements. |
| A019: misleading settings | Default deadline is 48 hours. Settings reject other deadlines or playoff counts; command definitions expose the supported values. Retired result-confirmation/approval options are removed from the slash-command schema and settings display. Old stored fields remain for schema compatibility. |

## Staff workflows

**Advance a week:** run `/week advance`. Review completed/unresolved games, then confirm. Unfinished games block normal advancement. Explicit force advancement preserves unresolved games without inventing a result. A backup is created before the commit; public statistics publish and the next week's threads open. The 48-hour countdown starts when threads are created.

**Start playoffs:** after Week 15, finalize all remaining games, then run `/week playoffs` or use website Admin → **Review playoff seeding**. Review the saved seeds and confirm. Another Staff member cannot use your confirmation; changed closeout data requires a fresh review. Repeating the confirmed request does not seed again.

Existing submitted trades, FA windows and pending waivers retain their saved rules and can finish after the handoff. On-time bidders may still join an existing regular-season FA window; new windows and improvements close. New waiver requests, trade proposals and upgrade spending close; pending upgrades expire. Regular-season corrections are blocked once playoff seeds have been confirmed, so settle corrections before that confirmation.

**Correct a final:** open its review page from the website Staff checklist's approved-games section or Team Stats game log. Enter your name and a reason, choose **Correct approved result**, edit and revalidate, then approve. The old result stays official until replacement approval. **Reverse approved result** requires a second click and preserves the old result in history. A forfeit can be reversed before Staff records the correct result.

**Reject an upload:** use the review page's reason and rejection action. Coaches can submit another attempt; originals and extraction history stay preserved.

## Storage and recovery

Run one bot/website writer against a data root. The bot serves the website itself; do not run `npm run start:web` against the same root at the same time. The standalone website is an alternative entry point.

Use the website **Create backup** button while the bot runs. For an offline backup, stop the writer first:

```sh
npm run league:backup
```

An optional argument selects a copied/test data root:

```sh
npm run league:backup -- /absolute/path/to/test-data
```

Restore to a **new, nonexistent** directory, verify the restored league and media, then configure `FANTASYHQ_DATA_ROOT` to that directory before starting the bot:

```sh
npm run league:restore -- /absolute/path/to/backup /absolute/path/to/restored-data
```

Restore checks every file's checksum and refuses unsafe paths or an existing destination. A corrupt original is retained in the backup and listed in its manifest; restoring it preserves the evidence and does not magically repair it. Keep a known-good snapshot for recovery. Do not edit backup files. Copy selected snapshots off the deployment volume; same-volume backups do not cover loss of the volume itself.

Normal shutdown releases the writer lease. A dead local process can be recovered automatically. A lease from another host remains protected while its heartbeat is recent; a stopped/crashed foreign host can be recovered after two minutes. If an incomplete lock or recovery directory needs manual intervention, verify all writers are stopped before moving that lock aside. Never remove a live writer's lock.

Backups are retained; review available disk space and export/remove obsolete snapshots according to your retention policy.

## Separate website Staff access

Configure `WEBSITE_ADMIN_KEYS` as a JSON mapping of Discord user IDs to separate private keys:

```json
{"COMMISSIONER_DISCORD_USER_ID":"REPLACE_WITH_A_PRIVATE_RANDOM_KEY","ASSISTANT_DISCORD_USER_ID":"REPLACE_WITH_ANOTHER_PRIVATE_RANDOM_KEY"}
```

Each Staff member enters their own key. The server binds actions and audit attribution to their configured Discord ID regardless of entered operator text. Commissioner operations require the key mapped to the league commissioner ID. Staff keys retain Staff review access. When this mapping is configured, `WEBSITE_ADMIN_KEY` does not authorize access. Without it, the legacy shared key remains supported and the entered operator name is an assertion rather than individually authenticated identity. Invalid mappings fail closed. Keep keys in server variables, never in Git or URLs.

## Verification and remaining live gates

Earlier repair baseline `npm run check`: **455 tests passed, zero failures, zero skipped/cancelled/todo**. This includes syntax checks, TypeScript checking, local browser tests and saved-image OCR. `git diff --check` passed.

Automated verification covers a complete 210-game/15-week closeout; eight seeds per conference; tiebreakers; final correction/reversal and frozen publication; real malformed HTTP requests; interrupted admin transactions; owner replacement; obsolete private membership removal; failed-notification restart/retry; corruption preservation; verified backup restore; and separate-process writer exclusion. Existing browser tests and real offline OCR image tests are included in `npm run check`.

All 22 command definitions serialize uniquely, including `/week advance` and `/week playoffs`. Registration must be refreshed when this release is deployed.

Read-only Railway inspection found one running production replica, a ready `/app/data` volume with 5,000 MB capacity and approximately 685 MB used, and the `leaguebuddy.up.railway.app` domain. These repairs have not been deployed or registered during this repair pass. Remote storage inspection through SSH was unavailable because no SSH key was configured.

Before claiming full live readiness:

1. Deploy this verified release and refresh command registration. Confirm startup backup, writer lease, health and the actual persisted data root on Railway.
2. In an isolated Discord server, use two real coaches and both Staff roles. Confirm other-team proofs/threads remain private; replacing a coach removes access and invalidates prior consent. Test Mode alone cannot establish this.
3. Complete trade/FA/waiver/upgrade and correction/reversal actions through real interactions; verify private deliveries, winner-cut controls, Staff pins and retries.
4. Restore a production-shaped backup into a separate test data root and confirm saved media, rosters, history, standings and seeds. Export a recovery copy outside the Railway volume.

The original audit's 64% is historical. This report does not replace unverified live gates with a “100%” label.

For the current launch audit, use [Pass 1](LAUNCH-AUDIT-PASS-1.md), [Pass 2](LAUNCH-AUDIT-PASS-2.md) and [launch operations](LAUNCH-OPERATIONS.md). Earlier test totals and deployment observations above describe that earlier repair baseline.
