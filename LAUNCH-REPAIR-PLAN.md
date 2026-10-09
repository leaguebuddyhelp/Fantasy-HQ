# Prioritized repair plan — approval required

Baseline: October 8, 2026, commit `f1c40ed6835c6451b45bcc559fda5582be0eedb2`. Initial readiness **65/100**. **No repair branch or source changes exist from this audit.**

Pass 2 may begin only after explicit approval. Approval to repair is not approval to deploy, merge, mutate production league records, delete Discord history, or reset a volume. Prepare reviewable repairs and verification first.

## Sequence and acceptance gates

| Order | Finding | Work after approval | Required evidence |
| --- | --- | --- | --- |
| 1 | LA-01, P0 | Inspect the real writer holder, process/container identity, heartbeat and deployment handover. Improve safe stale-lock/process-identity recovery without removing fencing or permitting two writers. Define explicit guarded operator recovery if needed. | Regression tests for PID reuse, live owner, stale/different host, startup race, lease loss, interrupted recovery and restart; isolated Node 22/container startup. Production recovery/deployment remains a separate authorized action. |
| 2 | LA-02, P1 | Centralize website principals/capabilities. Bind audit operator and service actor to the authenticated identity. Apply consistent commissioner-only versus Staff authorization across week, cleanup, imports, resets, roster controls and review endpoints. Correct credential documentation. | Table-driven endpoint tests for anonymous, invalid, named Staff, named commissioner and legacy key; forged operator/body identity cannot alter authority or attribution. |
| 3 | LA-04, P1 | Correct authenticated Sportsbook Staff actor construction using the shared authorization adapter. | Actual authenticated route succeeds, unauthorized route fails, both credential modes work, no coach data leaks through public responses. |
| 4 | LA-03, P1 | Unify bounded phone-format intake and original/derivative handling. Improve contract screen/table detection and OCR uncertainty handling; verify each scanner's actual upload path. | Screenshot + phone JPEG/PNG + EXIF + tilt + real HEIC expected-value fixtures across games, FA and each offseason import; supplied photos scored against reviewed truth; failed OCR stays correctable and cannot silently finalize. |
| 5 | LA-05, P1 | Establish a reviewed correction policy for previously spent fictional payouts. Add Staff prepare/confirm resolution, immutable ledger adjustments and explicit wallet recovery. | Correct/insufficient/duplicate/revised corrections, race and retry tests; no negative or invented balances, original settlements retained; Discord/website completion flow verified. |
| 6 | LA-06, P1 gate | Determine whether the local bound dataset is production or practice. Inventory production data read-only; identify authoritative 15-player rosters and legacy Test Mode status. Make a reviewable reconciliation plan; guard production/practice separation. | Every intended production team passes roster validation; historical memberships and player IDs preserved; legacy mode disabled on production or proven isolated; real owner/team-role consistency. Any actual roster cuts/data changes require their own authorized review. |
| 7 | LA-07/08/09, P2 | Make singleton-panel recovery idempotent, fix desktop navigation wrapping/layout, and replace ignored roster dependencies with committed sanitized fixtures. | Reconnect/send-before-receipt duplicate recovery tests; normal Staff sees one panel per purpose; fresh-archive checks pass; desktop/tablet/phone navigation works without document overflow. Live pin cleanup needs separate authorization. |
| 8 | LA-10/11/12/13, P2 | Remove avoidable GET writes; clarify/provide isolated website practice views; document readiness/backup operations; remove proven dead handlers and review bot/command privilege scope. | Read endpoint state hashes unchanged; simulated website data cannot cross into live outputs; verified restore into a new isolated target; command/feature inventory remains intact; permission matrix tested. |

## Repair branch and preservation

After approval, create a dedicated branch from the audited commit, accounting for any later user changes. Keep each significant repair reviewable with its regression coverage. Reuse existing identity, storage, OCR, transaction, statistics and publication services; do not create parallel databases or overlapping commands.

Preserve permanent IDs, game evidence, historical results, contract history, rosters, awards, News, payouts and archival records. Recovery tests must use temporary repositories. No direct JSON edits should be used to erase an inconvenient blocker. No automated cuts of imported players are authorized by this plan.

## Re-audit and final score

After repairs:

1. Run syntax/type checks and the entire automated suite from a clean archive with committed fixtures.
2. Run meaningful new service/route regressions for each significant repair.
3. Exercise actual local/staging HTTP handlers with normal coach, alternate coach, Staff and commissioner identities, including role revocation and wrong-team attempts.
4. Re-run desktop/tablet/phone browser workflows, not only anchor smoke tests: review/correct/approve a game; Staff weekly report; trade consent; FA offer/correction; mock class/lottery/start/pick/recap; Sportsbook private session/correction; ordered offseason; isolated Simulation restore.
5. Re-audit affected command/button registration, acknowledgment, singleton panel recovery, data integrity, original hashes, journal retry and archive preservation.
6. Collect separately authorized production evidence for connectivity, permissions, one writer, persistent data and independent backup/restore. Explicitly identify any behavior still unverified.
7. Score the same eight categories used in Pass 1. Report Initial versus Final score, unique issues fixed, remaining P0/P1 findings and launch recommendation.

Do not award READY from a passing suite alone. All critical blockers and required verification gates must close. Otherwise recommend CONDITIONAL or NOT READY with precise remaining conditions.

## Deliverable status at the end of Pass 1

```text
Initial Score: 65/100
Final Score: Not assessed — Pass 2 not authorized
Issues Fixed: 0
Remaining Launch Blockers: 6 (1 P0, 5 P1)
Launch Recommendation: NOT READY
```

**STOP: await explicit approval for Pass 2. No automatic deployment or merge.**
