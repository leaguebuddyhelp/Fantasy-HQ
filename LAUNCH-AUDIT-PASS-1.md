# LEAGUEbuddy launch audit — Pass 1

Audit date: October 8, 2026. Evidence collected through approximately 23:05 UTC.

Audited commit: `f1c40ed6835c6451b45bcc559fda5582be0eedb2` on `main`. The working tree was clean when the audit began. This report evaluates that commit, the local candidate league data, read-only Discord configuration, and read-only Railway deployment evidence. Earlier readiness reports are historical context, not current verification.

**Initial Score: 65/100**

**Launch Recommendation: NOT READY**

**Remaining Launch Blockers: 6 unique findings — 1 P0 and 5 P1.** One of these is a candidate-data release gate whose production-volume status remains unverified; it is explicitly distinguished below from verified production failures.

**Final Score: Not assessed. Issues Fixed: 0. Pass 2 has not been authorized.**

## Pass boundaries

No application source was modified. No branch was created, repair performed, command registered, deployment started, merge performed, or live league/Discord data intentionally mutated. Discord access used GET requests only. Railway access used status, deployment-list and historical-log reads only. Production HTTP probes targeted `/health`, `/`, and `/app.js`; no league APIs were called.

Tests ran in a temporary archive of the audited commit, without `.env`, Discord credentials, or a live bot connection. Additional probes used fixture repositories or a separate copy of local league JSON. Browser requests that can write market state affected only that temporary copy. A provided HEIC photo was read locally; its bytes were not changed or uploaded.

Reports created by this audit are documentation, not repairs. Stop here pending explicit approval for Pass 2.

## Scoring

This is a weighted engineering assessment of launch readiness, not a probability of success or a percentage derived from passing tests. P0/P1 blockers override the numerical score when making the launch recommendation.

| Area | Earned | Maximum | Basis |
| --- | ---: | ---: | --- |
| Repository and architecture | 9 | 10 | Existing services and storage reused; reproducibility and obsolete surfaces need attention. |
| Automated and integration verification | 13 | 15 | Syntax/type checks and 609 tests passed from an archive; missing untracked fixtures caused one failure, which passed after supplying a copy. Production verification remains incomplete. |
| Security and command isolation | 10 | 15 | Strong coach/session protections; inconsistent website principal handling and commissioner boundaries. |
| Data integrity and historical preservation | 10 | 15 | Atomic journals, historical memberships and backup tests; candidate rosters fail the 15-player rule, and the Railway volume was not inspected directly. |
| Discord workflows and usability | 8 | 15 | Registered command schemas match; channels and permissions inspected; duplicate Staff panels and failed deployment prevent confidence in live interactions. |
| Website workflows and usability | 8 | 10 | Isolated desktop/mobile smoke audit had no JavaScript exceptions; desktop navigation overflow and Staff API defect reproduced. |
| OCR and image intake | 5 | 10 | Screenshot and game JPEG-photo tests pass; contract phone variants fail, HEIC support differs between scanners. |
| Deployment and operations | 2 | 10 | Persistent volume and one-replica configuration exist; current deployment fails startup/health checks. |
| **Total** | **65** | **100** | **NOT READY** |

## Launch blockers

### LA-01 — P0: Railway deployment fails before startup

**Verified production evidence.** Railway reports the latest deployment `38ff86b1-d238-4bec-b339-4f9be0125530`, built from the audited commit, as `FAILED`. The previously active deployment `04c3faab-abb3-4f5f-b1be-441f8a45ae8a` is `CRASHED`/stopped. The current image built successfully, but all health-check attempts failed.

Runtime logs repeatedly report: `League storage already has a writer (bf929ae04c7b, PID 13). Stop it before starting another bot or website writer.` The exception originates at `src/fantasyhq/storage-safety.js:33`, before the website starts. Railway is configured for one replica and a volume at `/app/data`.

An isolated probe also demonstrates that an old lock with a reused, currently alive PID is rejected even when no other league writer exists. The lease implementation checks same-host PID existence without proving that the process owns the recorded lease. **This is a verified recovery weakness, but the exact cause of the Railway lock conflict is not established:** a competing writer, stale lock, PID reuse, host identity, and heartbeat state require investigation. Static/health HTTP probes timed out; they do not independently distinguish an application failure from a network-path problem.

Do not remove the writer lock blindly or disable single-writer protection. Verify the actual holder and backup status before recovery. Launch requires a successful startup and a verified single writer, without deployment/merge being automatic.

### LA-02 — P1: Website identity and commissioner authorization are inconsistent

**Verified in an isolated route probe and source.** A valid named `assistant` website key can call `/api/league/admin/week` with `operator: "Impersonated Commissioner"`. The route passes an authorized actor with ID `website-commissioner:Impersonated Commissioner` and the caller-supplied operator to the service. It does not bind the operator to the authenticated named principal or apply the commissioner-ID restriction used by newer offseason/postseason routes.

The route probe used a fake week service to capture the actor; it did not advance any league. Other older routes, including game cleanup, use similar manually parsed operator handling. Newer routes require credentials keyed by the commissioner Discord user ID, while `.env.example` describes named credentials as Staff names. Box-score approval records also hard-code `website-commissioner-key` as the principal.

This permits misleading attribution and leaves commissioner-only versus Staff capabilities inconsistent. The authenticated key is still required; this is **not** an anonymous access bypass. Define capability boundaries once, bind actor/audit identity to the authenticated principal everywhere, and document the credential naming contract. Verify actual commissioner controls and ordinary Staff controls separately.

### LA-03 — P1: All scanners do not reliably support phone photos

**Verified OCR and intake gap; see [OCR-COMPATIBILITY-AUDIT.md](OCR-COMPATIBILITY-AUDIT.md).** Game screenshot, framed JPEG, EXIF orientation and modest-tilt tests pass. Offseason normalization successfully decoded a real 4284×5712 phone HEIC and produced OCR text without altering its original bytes.

Free-agent contract OCR correctly reads the three existing direct 4K image fixtures. However, temporary variants of the Payne fixture with phone-style framing, four-degree tilt or EXIF rotation produced missing or incorrect salary/years/option fields. The specialized contract crop assumes an approximately 16:9 complete screen; fallback recognition did not recover all fields in these probes.

Game and regular-season free-agent upload gates reject native HEIC, while offseason imports accept it. JPEG/PNG phone photos are accepted; native phone-photo coverage is not consistent. Expand intake and evidence-based layout recognition without accepting uncertain numbers silently. Keep manual correction and validation mandatory when OCR is uncertain.

### LA-04 — P1: Valid website Staff cannot inspect Sportsbook

**Verified route response:** `/api/league/admin/sportsbook` returns HTTP 400 with `Staff authorization required.` even with a valid website key. Anonymous access correctly returns 403.

The route constructs `{ id: principal.principal, authorized: true }`, but `requirePostseasonStaff` needs either an authorized commissioner ID or `staffAuthorized: true`. The constructed actor satisfies neither. The existing API test verifies anonymous denial but does not exercise this authenticated success path. Staff review access must work with both supported credential modes and deny unauthorized users.

### LA-05 — P1: Corrected Sportsbook payouts can leave a permanent frozen workflow

**Verified source and passing regression fixture.** When previously awarded money has already been spent, settlement preserves the original settlement, records `pendingCorrection`, and freezes new wagers. This safeguard prevents negative-balance corruption.

However, settlement skips records with `pendingCorrection`; the exported service has no resolution/unfreeze operation, and neither Discord nor the website provides a Staff correction decision. Users are told Staff is reviewing the correction, but the workflow cannot be completed through supported application controls. LA-04 additionally blocks the website Staff inspection route.

Specify the correction policy, then implement an authorized, confirmed, audited and idempotent resolution that preserves the ledger and original settlement. Do not invent funds or clear pending corrections manually as a shortcut.

### LA-06 — P1: Candidate league data is not launch-ready

**Verified on local disk; production-volume equivalence is unverified.** The bound candidate league has 30 teams, 653 players, and 536 active current-season memberships. There are no duplicate player IDs, duplicate active memberships, unknown player references or malformed JSON in the inspected canonical snapshot. But **28 of 30 teams exceed 15 players**, with roster counts ranging from 15 to 22. Only Chicago and New York have exactly 15.

The preseason validator correctly rejects these rosters. Regular-season trades require exactly 15 after a transaction; free-agent winners on oversized rosters cannot complete the final signing cut until other approved waivers reduce the roster. Thus the candidate data does not support representative transaction testing or launch under the app's own rules. The league JSON already identifies its phase as `REGULAR_SEASON`.

This candidate also has `testMode: true` with no `simulationId`. That legacy setting enables Staff-simulated sides/vacant-team FA participation on the canonical repository; it is distinct from the isolated Simulation workspace. Do not assume the isolated dashboard makes that legacy flag harmless. There are only two assigned owners; unowned/CPU teams are expected to exist and are not counted as a separate defect.

Before launch, inspect the actual production volume, identify the authoritative roster dataset, reconcile approved 15-player rosters, and ensure production practice operations use isolated workspaces. **Do not auto-cut players, erase memberships, or silently turn a test league into the production league.** If this dataset is intentionally practice-only, prove that production is bound to a separate compliant dataset to close this gate.

## Additional findings

| ID | Priority | Finding | Verification / consequence |
| --- | --- | --- | --- |
| LA-07 | P2 | Duplicate Staff pins | Discord currently has two identical Test Mode pins and two identical Live Reset pins. Reconciliation trusts one saved message ID and does not recover/remove duplicates. Use one canonical panel per purpose; preserve historical reports. |
| LA-08 | P2 | Desktop navigation overflows | At 1440px the actual `#primary-nav` extends to approximately 1569px, causing document overflow. At 390px there was no document-level horizontal overflow. Mobile table content remains inside scroll containers. |
| LA-09 | P2 | Tests require untracked roster data | A clean git archive fails the scanned-roster MyTeam test because `data/2kratings/rosters/2026-10-07` is absent. Copying the read-only local roster snapshot into the isolated archive makes all three MyTeam tests pass. Make fixtures reproducible without production data. |
| LA-10 | P2 | Some GET routes write state | Public Sportsbook GET refreshes/persists markets; private wallet GET creates a wallet; Staff News GET detects/persists drafts. This complicates read-only monitoring, audit tooling and caching. These production APIs were intentionally not invoked in Pass 1. |
| LA-11 | P2 | Website does not provide a Simulation workspace view | The isolated engine/Discord dashboard exists, but website API repository selection remains the canonical league. A practice run does not automatically become a website test dashboard. Provide an explicitly isolated view or document this limitation and separate website test fixtures. |
| LA-12 | P2 | Operational verification and backup management incomplete | Local backup/restore and manifest protections are tested. Backups remain on the same data root; independent production restore evidence, external copy/retention and capacity monitoring were not established. `/health` reports HTTP availability, not Discord connectivity or complete league readiness. |
| LA-13 | P2 | Permission and obsolete-surface cleanup | The bot's live role has Administrator. Declared Staff commands generally rely on server-side checks rather than command visibility permissions. Legacy handlers remain for some unregistered features. Review least privilege and retire unreachable paths after proving feature preservation. |

Missing pins in News, Streamlink, Power Rankings and Player of the Week are **not** automatically defects: these are event/history feeds, and awards/rankings wait for official publication triggers. No new channels or automatic deletion of existing channels is justified by this audit.

## Coverage by workflow

| Workflow | Inspected / tested evidence | Remaining verification |
| --- | --- | --- |
| Setup, ownership, role recognition | Repository/setup/role ownership tests; current 31 Discord channels and 37 roles; team-role plus current owner identity guards | Role changes and pin refresh using distinct real accounts, against a healthy deployment |
| Available teams | Live single pin, registered `/availableteams`, conference/division grouping and ownership invalidation tests | Real assignment/removal cycle; command is not read-only internally, so not invoked live |
| Games and OCR review | Thread/submission/side authorization, duplicate originals, fuzzy matching, uncertainty checks, manual correction, approval, reversal and review-page tests | Real phone capture corpus, two distinct coach identities, Discord deadlines and receipt behavior |
| Weeks, standings and statistics | Advancement confirmation/idempotence; publication cutoff; historic team membership; forfeits without invented stats; qualification tests | Production weekly advance and new weekly Staff report; principal defect LA-02 |
| Weekly Staff/My Week | CPU–CPU, user–CPU and user–user counts/completion totals; pending trades/FA/waivers and game checklist tests | Edit existing week's report and create exactly one next-week report in production |
| Trades, FA and waivers | Ownership-consent invalidation, transaction locks, protected/cap/roster rules, review and proof tests | Real coach negotiations, DM restrictions/retries; LA-03 and candidate rosters |
| Upgrades, contracts and MyTeam | Coach-submitted progress restrictions, contract valuation/display, compact embed tests | Production portrait/contract coverage; missing contract must remain explicitly unknown |
| Scouting and mock drafts | Four-class choices, weekly deterministic projections, randomized live lottery, reach/elite guards, positional needs and contract fit tests | Actual private draft room, chooser/dropdown/panels, role changes and shared final recap/DM delivery |
| Playoffs and awards | Existing top-eight conference/tiebreaker policy; bracket/service/page tests; historical awards and published stats | Real series progression and award confirmation; no production playoff actions performed |
| Ordered offseason | Retirement/lottery/draft/options/FA/progression imports, immutable originals, prepare/confirm receipts, archival/cutdown/next-season checks | Verified expected rows across real phone captures for every import; full production dry run remains prohibited in Pass 1 |
| Player of the Week / rankings | Deterministic verified performances, efficiency/ties, publication timing, history/portrait/page tests | Exactly one live weekly post, real portrait mapping and profile links after advancement |
| News / streams | Approved publication/corrections, verified facts, stream persistence/locking, page tests; home-team stream reminder is a general instruction rather than tracked home/away state | Real link button flow and send/restart/receipt behavior; GET side effects noted |
| Sportsbook | Cents/payout/own-team/session/idempotence/settlement/parlay tests; route probes | LA-04/05; real private-session role revocation and Staff completion flow |
| Test Mode | Workspace manifests, checkpoint restore, pause/resume, labels, offseason rollover, transaction bypass refusal on live repositories | LA-06 legacy flag; LA-07 duplicate panels; LA-11 website isolation visibility |
| Deployment / storage | Fresh Railway state/logs; atomic writes, corrupt-file preservation, journals, backups, restore, writer tests | LA-01; actual production volume inventory, exclusive writer and healthy deployment |

## Command and channel isolation

The local definitions contain **23 commands**. Discord has the same 23 guild commands and **zero global commands**. After normalizing omitted false/default/empty fields, names, types, permissions, subcommands, choices and bounds match. Descriptions were not retained in the initial sanitized API capture and were not compared. No duplicate global/guild command registration was found.

Current commands: `availableteams`, `mockdraft`, `week`, `activitycheck`, `tradeblock`, `standings`, `stats`, `teamstats`, `upgrades`, `games`, `game`, `bigboard`, `scout`, `toptenpreview`, `schedule`, `ratings`, `player`, `myteam`, `freeagents`, `admin`, `league`, `roster`, `team`.

Related surfaces generally share services: slash command versus dashboard access is not itself duplicate business logic. The verified duplicate-control defect is the Staff pins. The current main dispatcher acknowledges chat commands before calling handlers; the reviewed Big Board and Team handlers edit that acknowledgment. Older Railway logs contain `10062`/`40060` interaction errors, but those logs are from a previous deployment and do not prove the audited commit still has a duplicate-ack bug. Production interaction success remains unverified.

All 31 inspected channel/category names start with `lb-`. The managed league section contains 25 text channels; `lb-time-off` is last at position 24. Staff and Trade Committee channels deny `ViewChannel` to everyone and grant their designated roles. The bot's Administrator role overrides channel restrictions, so successful API reads do not prove a normal coach can access every intended surface.

## Security and data integrity assessment

Positive evidence includes server-derived coach identity, current-role revalidation, one-use hashed login tokens, HttpOnly/Secure/SameSite cookies, origin checking for coach mutations, blocked owner/team spoofing, bounded JSON bodies/images, pixel limits, queued HEIC workers, immutable screenshot evidence, ambiguous OCR rejection, atomic journals, corruption preservation and checksum-verified restore into a new target.

No `.env` or canonical `data/` files are tracked in this commit; Docker excludes them. Build logs report zero production dependency vulnerabilities at install time. This is not a proof against all vulnerabilities or a full historical secret scan. Public league/player information is an intended surface; private Staff review and betting data require authorization.

Significant issues are the inconsistent authenticated principal/capability model, the unusable Staff Sportsbook path, a missing correction completion flow, and candidate production/practice data separation. Source review also found no general website request-rate limiter or Content Security Policy; these are hardening opportunities, not demonstrated anonymous exploitation. Error responses can disclose operational paths; redact sensitive internals while retaining private diagnostic evidence.

## Verification limits and stopping decision

Automated tests include service integration, fake Discord interactions, real OCR fixtures and browser tests with routed/mock responses. The extra website smoke audit used actual local HTTP handlers against a copied candidate dataset at 1440×900 and 390×900; it did not connect a real Discord client. Anonymous Sportsbook sign-in errors were expected. Passing fixtures do not establish production Discord permissions, message delivery, two-person consent, connection uptime or volume correctness.

No production form submissions, slash commands, button presses, pin edits, owner changes, OCR uploads, market refreshes, week advances, resets or restore operations were performed. The production data volume and an independent production restore remain unverified. Those checks must be planned in Pass 2 with safe fixture/staging boundaries and explicit handling of any live mutation.

See [LAUNCH-AUDIT-EVIDENCE.md](LAUNCH-AUDIT-EVIDENCE.md), [OCR-COMPATIBILITY-AUDIT.md](OCR-COMPATIBILITY-AUDIT.md) and [LAUNCH-REPAIR-PLAN.md](LAUNCH-REPAIR-PLAN.md).

**Pass 1 ends here. Pass 2 requires explicit user approval. Do not deploy or merge automatically.**
