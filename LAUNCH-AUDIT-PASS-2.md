# Launch repairs and re-audit — Pass 2

Date: October 9, 2026. Initial audited commit: `f1c40ed6835c6451b45bcc559fda5582be0eedb2`. Repair branch: `repair/launch-readiness`.

The user explicitly approved Pass 2 with “fix everything please,” then required the Sportsbook to stay entirely in Discord. Repairs preserve existing league data and historical records. No deployment, merge, live Discord mutation, roster cut, reset or lock deletion was performed.

## Deliverable

| Measure | Result |
| --- | --- |
| Initial Score | **65/100** |
| Final Score | **83/100** |
| Issues Fixed | **9 audit findings addressed in source with regression evidence** |
| Remaining Launch Blockers | **2 production acceptance gates: LA-01 and LA-06** |
| Launch Recommendation | **NOT READY for production launch** |

The score increased by 18 points. This is a weighted engineering assessment, not a probability or a percentage of passing tests. Production acceptance gates override the score. “Fixed” refers to reviewable source repairs; those repairs have not been deployed or verified in the live guild.

## Readiness scoring

| Area | Initial | Final | Maximum | Evidence and remaining limits |
| --- | ---: | ---: | ---: | --- |
| Repository and architecture | 9 | 9 | 10 | Existing identity, transaction, OCR and betting services reused; included repository fixture paths and CI configuration added. |
| Automated and integration verification | 13 | 14 | 15 | Isolated syntax/type, service, integration, browser and OCR checks; real multi-coach production behavior remains unverified. |
| Security and command isolation | 10 | 14 | 15 | Authenticated website actors, commissioner boundary, role/owner rechecks and isolated-only practice bypasses. Live bot least privilege remains an operator task. |
| Data integrity and historical preservation | 10 | 11 | 15 | Immutable originals, ledger correction history, simulation separation and read-only preflight. Candidate rosters and deployed volume identity remain unresolved. |
| Discord workflows and usability | 8 | 12 | 15 | Discord-only Sportsbook, paginated private controls, Staff payout review and singleton recovery. No live reconciliation performed. |
| Website workflows and usability | 8 | 10 | 10 | Desktop/tablet/phone navigation checks, protected HEIC preview, commissioner practice preview and launch checks. Betting website retired. |
| OCR and image intake | 5 | 9 | 10 | Screenshot, framed JPEG, tilt, EXIF rotation and real HEIC normalization verified. Entire supplied photo corpus has not been scored against manually reviewed truth. |
| Deployment and operations | 2 | 4 | 10 | Safer writer recovery, reproducible checks and backup/restore instructions. Failed Railway service was not replaced; independent production restore remains unverified. |
| **Total** | **65** | **83** | **100** | **NOT READY** |

## Repairs and finding disposition

| Finding | Disposition | Concrete repair |
| --- | --- | --- |
| LA-01 · writer startup | Source mitigation prepared; production gate open | Linux boot/process-start fingerprint, reused startup PID recovery, same-process writer exclusion and unchanged token fencing. Fresh/live owners remain protected. No live lock was removed. |
| LA-02 · website principal/capability boundary | Source repaired | Shared website actor binds real configured principal; named Staff cannot perform commissioner transitions, imports, roster controls, cleanup or week advancement. Review audit attribution uses authenticated principal. Credential documentation uses Discord IDs. |
| LA-03 · phone OCR/HEIC inconsistency | Source repaired; corpus limits disclosed | Game, FA and shared offseason intake accept bounded JPEG/PNG/WebP/HEIC. Contract OCR detects offer rows and corrects modest tilt after orientation. Native HEIC decoding runs in a bounded worker. Protected PNG derivatives display in browser review; original evidence remains byte-identical. |
| LA-04 · unusable Staff Sportsbook website API | Resolved under revised scope | Website Sportsbook UI, script and betting endpoints retired. Old endpoints return 410 without touching betting storage. Staff reviews and resolves corrections in Discord. |
| LA-05 · permanently frozen spent-payout corrections | Source repaired | Staff prepare/confirm correction, actor-bound expiring previews, evidence/wallet freshness checks, idempotent receipts, retained settlement history and reconciled debt ledger. Future credits repay debt. |
| LA-06 · candidate data/practice readiness | Production gate open; separation strengthened | Read-only roster/ownership/legacy-mode preflight and website report. Solo-game finalization, vacant-team trades, simulated committee actions and FA practice consent require an isolated workspace; legacy canonical flags do not grant practice authority. No roster was automatically cut. |
| LA-07 · duplicate Staff panels | Source repaired; live recovery unverified | Shared singleton recovery finds bot-owned pinned/recent panels, serializes concurrent reconciliation, records receipt and disables/unpins duplicate controls while preserving history. Applied to Test Mode, Live Reset and Sportsbook Staff panels. |
| LA-08 · desktop overflow | Source repaired | Header/navigation wrap without horizontal page overflow at 1440, 1101, 768 and 390 pixels. |
| LA-09 · ignored roster test dependency | Source repaired | MyTeam reads included sanitized roster fixtures, with no dependency on ignored scan output or .env. |
| LA-10 · avoidable Sportsbook GET writes | Source repaired | All website betting operations retired; wallet reads do not persist initialization, and service refresh can compute without saving. Historical storage is retained. Existing journal recovery on ordinary repository reads remains an intentional storage behavior under the app writer. |
| LA-11 · missing website practice view | Source repaired | Commissioner-only read-only preview of the active isolated simulation, clearly labeled. Mismatched identity, wrong league and pending restore are rejected. Live pages remain canonical. |
| LA-12 · operational backup/readiness evidence | Documented; production evidence open | Existing verified-copy restore tests retained; explicit independent backup/restore drill and production acceptance instructions added. Same-volume backups alone are insufficient evidence of independent recoverability. |
| LA-13 · obsolete dispatcher/privilege scope | Partially addressed | Removed four unregistered command handlers from dispatch. Existing modules/history retained. Live Administrator role unchanged; separate-guild minimum-permission verification remains outstanding. |

Nine findings are counted as repaired in source: LA-02, 03, 04, 05, 07, 08, 09, 10 and 11. LA-01, 06, 12 and 13 remain open or partial; only LA-01 and LA-06 were classified P0/P1 launch blockers in Pass 1.

## Verification

Tests ran against a temporary repository copy without .env or live league data, using temporary league fixtures and the installed dependency tree. Local browser/server execution required sandbox permission; it did not authorize production operations. Saved-image OCR ran locally.

- Full verification result: **625/625 tests passed, zero failures/skips/cancellations; syntax and TypeScript checks passed**.
- Earlier complete repaired-copy run passed **622/622** tests, with syntax and TypeScript checks. Subsequent isolation and HEIC improvements received focused regressions and a final full rerun.
- Focused Discord betting, image, layout and new repair checks passed **25/25** before the final isolation expansion.
- Focused trade, Discord trade, game submission, extraction and launch isolation checks passed **75/75**.
- Protected HEIC original/preview, actual browser review caching and normalization checks passed **4/4**.
- Contract OCR fixtures verify actual expected salary, years, structure and option for three supplied signing screenshots, plus bordered, four-degree tilted and EXIF-rotated phone variants.
- A real 4284×5712 HEIC fixture normalizes to a bounded PNG, preserves original bytes and remains protected by Staff authorization in the review route.
- Wallet tests cover exact cents, own-team restrictions, revoked/mismatched roles, conflicting legs, closed games, expiry, changed odds, duplicate confirmation, settlement replay, corrections, spent-payout debt and future repayment.
- An additional 33-test final acceptance set passed, including protected image preview, browser review caching, registration/dispatch parity and offseason deadline clock consistency.
- No source or fixture change deletes canonical league records. `git diff --check` is part of the final review.

Final full-suite duration: 213,231 ms. All 358 source and fixture files match the tested isolated copy. Evidence: [full check](reports/launch-audit/2026-10-09/full-check.log), [focused acceptance](reports/launch-audit/2026-10-09/focused-acceptance.log), [isolation regressions](reports/launch-audit/2026-10-09/isolation-regressions.log), and [verification metadata with file hashes](reports/launch-audit/2026-10-09/verification.json). These local evidence artifacts are saved in the ignored reports directory. CI is configured for Node 22 with Chromium; the remote CI job and Railway container were not executed as part of this local pass.

## Remaining blockers and unverified behavior

1. **LA-01 — production availability:** Pass 1 observed Railway startup failing on a writer conflict and an unhealthy latest deployment. The source repair has local lease regressions, but a separately authorized deployment/restart must prove one writer, persistent data, Discord connectivity and healthy HTTP service. Do not remove a live lock blindly.
2. **LA-06 — authoritative production data:** The audited local candidate had 28 oversize teams and canonical `testMode:true` with no isolated simulation ID. Local data is not proven identical to the deployed volume. Staff must approve authoritative 15-player rosters and the intended league mode, preserving historical memberships. Read-only preflight does not verify current live role membership.

Other limits: live singleton recovery, real two-coach interactions, Discord pin permissions, private recap delivery, the bot’s minimum permission role, independent backup recovery, production HEIC resource behavior and the full supplied image corpus remain unverified. Browser layout checks do not replace a complete human usability session. No READY recommendation is justified until critical gates close with evidence.

## Review and operation references

- [Original audit](LAUNCH-AUDIT-PASS-1.md) and [original evidence](LAUNCH-AUDIT-EVIDENCE.md)
- [Sportsbook in Discord](SPORTSBOOK-DISCORD.md)
- [Launch, data and backup procedures](LAUNCH-OPERATIONS.md)
- [Team-by-team candidate roster review](ROSTER-LAUNCH-REVIEW.md)
- `node scripts/inspect-launch-readiness.js <data-root> <league-id>` — read-only preflight; exits nonzero for blockers

No automatic merge or deployment follows this report.
