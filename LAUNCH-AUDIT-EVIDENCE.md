# Pass 1 evidence register

Commit: `f1c40ed6835c6451b45bcc559fda5582be0eedb2`. Date: October 8, 2026.

This register distinguishes source inspection, isolated execution, live read-only configuration, and unverified production behavior. None of the observations below authorized a repair or deployment.

## E-01 — Isolation and repository baseline

`git status --short`, `git diff --exit-code` and `git diff --cached --exit-code` were clean before report creation. Tests ran against a temporary git archive, not the working application or a production filesystem. Installed dependencies were shared through a `node_modules` symlink; application code/data were separate. The archive had no `.env` and no bot login was started.

Temporary evidence root: `/tmp/lb-pass1-audit-znl2y4pt`. Temporary evidence is not guaranteed to persist; relevant outcomes are recorded here. Raw Discord evidence includes IDs and overwrites but does not contain credentials or full message bodies. Reports do not include environment secret values.

## E-02 — Automated checks

Executed `npm run check` in the archive. Syntax checks and `tsc --noEmit` succeeded. The test summary was:

```text
tests 610
pass 609
fail 1
cancelled 0
skipped 0
duration_ms 213511.032
```

The failure was:

```text
every scanned NBA roster fits one compact myteam embed with all players and salary coverage
ENOENT: .../repository/data/2kratings/rosters/2026-10-07
```

That directory is ignored/untracked and absent from a clean git archive. A copy of the local roster directory was then placed in the temporary archive, and `node --test test/myteam-display.test.js` passed **3/3**. No application code changed between those executions. This establishes a fixture/reproducibility gap rather than a reproduced MyTeam formatting failure.

The full suite was not falsely reported as a second clean 610/610 run. Other verification came from the single-file rerun and additional isolated probes.

Existing tests exercised real game screenshot OCR, four-kilopixel images, camera framing/EXIF/tilt, real contract-image fixtures, review-page behavior, role ownership, trade/FA/waiver consent, corrupt canonical JSON, journal recovery, week idempotence, official publication cutoff, historical membership, awards, postseason, ordered offseason, isolated simulation, manifests/restore, News, streams and Sportsbook.

## E-03 — Railway status, build and runtime

Read-only CLI commands: `railway status --json`, `railway deployment list --json`, and bounded `railway logs --build/--deployment --lines ... <deployment-id>`.

| Observation | Result |
| --- | --- |
| Latest deployment | `38ff86b1-d238-4bec-b339-4f9be0125530`, created 2026-10-08T22:44:13Z |
| Latest source commit | Audited `f1c40ed...` |
| Latest status | `FAILED`, stopped |
| Previously active deployment | `04c3faab-abb3-4f5f-b1be-441f8a45ae8a`, `CRASHED`, stopped |
| Docker image build | Succeeded; Node 22 bookworm image |
| Dependency install | `npm ci --omit=dev`; build log reports 0 vulnerabilities |
| Configured replicas | One |
| Persistent volume mount | `/app/data` |
| Health check | `/health`; 11 unsuccessful attempts over the five-minute retry window |
| Current startup exception | Existing storage writer, host `bf929ae04c7b`, PID 13 |

Current runtime exception points to `storage-safety.js:33` and `index.js:56`. Logs from the preceding deployment also show Discord `Unknown interaction` / `Interaction has already been acknowledged` errors. Because those logs predate the audited deployment, they are historical evidence requiring re-verification rather than a confirmed current-code defect.

GET probes to `https://leaguebuddy.up.railway.app/health`, `/` and `/app.js` each timed out. They performed no league API operation. Network-path failure versus application unavailability was not independently resolved. The Railway deployment failure itself is directly verified.

No Railway environment variables were exported or printed. No restart, redeploy, service change, volume write or SSH recovery was performed.

## E-04 — Writer-lease recovery probe

In a temporary directory, a lock owner was recorded with the current hostname, the probe's live PID, a year-2000 start time, and an ancient heartbeat. There was no other league writer. `acquireWriterLease` rejected it because that PID was alive.

This reproduces the absence of process-ownership validation in same-host stale-lock recovery. It is a controlled PID-reuse model. It does **not** prove that Railway's actual conflict was PID reuse. The true holder/host/heartbeat and competing processes were not read from the production volume.

## E-05 — Discord configuration

Native authenticated GET requests read application identity, guild identity, channels, roles, bot membership, guild/global command definitions, and pin metadata in selected channels. The application identity matched the configured client. No API request in this collection used POST, PUT, PATCH or DELETE.

| Item | Result |
| --- | --- |
| Guild command count | 23 |
| Global command count | 0 |
| Local declared command count | 23 |
| Missing/extra commands | 0 / 0 |
| Schema differences | 0 after normalizing omitted defaults/empty options |
| Channels/categories | 31; all names have `lb-` prefix |
| Roles | 37 |
| Bot role permissions | Administrator |
| Managed text channels | 25 |
| Last managed channel | `lb-time-off`, position 24 |
| Staff visibility | Everyone denied ViewChannel; Commish/Assistant Commish allowed |
| Committee visibility | Everyone denied ViewChannel; designated review roles allowed |

Command comparison covered name, type, default member permissions, subcommands/options, choices and bounds. Descriptions were omitted from the sanitized live capture and not compared. Local command definitions were serialized from an in-memory/copy evaluation with deployment `main()` removed; the registration script was never run.

Pin observations:

| Channel | Pins observed |
| --- | --- |
| `lb-league-staff` | 4: two Test Mode panels, two Live Reset panels |
| `lb-available-teams` | 1 ownership embed |
| `lb-stats` | 1 stat-leaders embed |
| `lb-standings` | 1 message with 2 conference embeds |
| `lb-scouting-hub` | 1 live-mock entry panel |
| `lb-submit-trade` | 1 Build a Trade entry panel |
| `lb-free-agency` | 1 signing/active-offers panel |
| News, Streamlink, Power Rankings, Player of the Week | 0 pins; these are event/history feeds, so this alone is not a defect |

Duplicate Test Mode panels expose the same `sim:*` controls. Duplicate Live Reset panels expose the same `reset:*` controls. No buttons were clicked or messages edited/deleted.

## E-06 — Website Staff Sportsbook probe

Used an isolated three-team fixture with a commissioner ID and a dummy website key. Called the real website request handler, without Discord network access:

```json
{
  "staffSportsbook": {"status":400,"payload":{"error":"Staff authorization required."}},
  "anonymousStaff": {"status":403,"payload":{"error":"Staff authorization required."}}
}
```

Source chain: `src/web.js:332` → `sportsbook-service.js:222` → `postseason-state.js:52`. The route is authenticated but supplies the wrong authorization actor shape.

## E-07 — Website named-key identity probe

Used an isolated fixture, a named `assistant` dummy key, and a fake week service that captured its input. POSTing a caller-supplied `operator` returned a fixture preview and passed this actor:

```json
{
  "authorized": true,
  "id": "website-commissioner:Impersonated Commissioner",
  "operator": "Impersonated Commissioner",
  "commissionerUserId": "commissioner"
}
```

No actual advancement occurred. The actor capture verifies that this route does not use `bindWebsiteOperator` or preserve the named authenticated principal. Other offseason routes do enforce the commissioner Discord ID. This inconsistency must be resolved before relying on individual Staff keys for authority or attribution.

## E-08 — Actual-handler website browser smoke audit

Started an isolated local HTTP server using the exported website handler, a copied local league dataset, dummy website credentials, and no Discord client. Chromium exercised actual navigation anchors at **1440×900** and **390×900**: Home, My Week, Teams, Players, Stats, Standings, Playoffs, News, Watch Live, Sportsbook, Weekly Awards and Admin. This yielded 24 viewport/anchor observations.

- No uncaught JavaScript page errors.
- Desktop document overflow: true. `#primary-nav` right edge: approximately 1569px on a 1440px viewport.
- Phone document overflow: false. Wide table content was present inside its scroll region.
- Anonymous `/sportsbook/mine` requests returned expected sign-in errors.
- No real coach-session exchange, bet confirmation, Staff mutation or Discord-dependent website action was executed.
- Screenshots were temporary local artifacts. Original league data was not used as the server's writable repository.

Anchor smoke coverage is not proof that every button, profile dialog, screen-reader interaction or production API works. Browser tests in the automated suite add focused mocked/routed interaction coverage, including OCR review and recent feature pages.

## E-09 — Local candidate-data integrity

Read JSON directly from disk, without repository constructors/recovery/reconciliation against the original dataset. Inspected 32 canonical league JSON/game-record files: zero parse errors. The production Railway volume was not directly inspected.

| Metric | Value |
| --- | ---: |
| Teams | 30 |
| Players | 653 |
| Active current-season memberships | 536 |
| Missing referenced player IDs | 0 |
| Duplicate permanent player IDs | 0 |
| Duplicate active player memberships | 0 |
| Players with a contract object | 497 |
| Current assigned owners | 2 |
| Duplicate owned team IDs | 0 |
| Game status records | 13 SCHEDULED, 1 FINAL |
| Game records with simulationId | 0 |
| Canonical settings testMode | true |
| Canonical settings simulationId | absent |

Roster counts:

| Team | Players | Team | Players |
| --- | ---: | --- | ---: |
| Atlanta | 18 | Boston | 16 |
| Brooklyn | 18 | Charlotte | 20 |
| Chicago | 15 | Cleveland | 17 |
| Dallas | 19 | Denver | 18 |
| Detroit | 19 | Golden State | 19 |
| Houston | 19 | Indiana | 17 |
| Clippers | 18 | Lakers | 19 |
| Memphis | 20 | Miami | 18 |
| Milwaukee | 19 | Minnesota | 17 |
| New Orleans | 22 | New York | 15 |
| Oklahoma City | 17 | Orlando | 18 |
| Philadelphia | 16 | Phoenix | 18 |
| Portland | 18 | Sacramento | 16 |
| San Antonio | 18 | Toronto | 18 |
| Utah | 18 | Washington | 16 |

No claim is made that every player must have a contract: free agents and unknown contracts are valid cases. Counts alone do not prove salary correctness, cap compliance or authoritative roster membership.

## E-10 — OCR evidence

See the dedicated [OCR report](OCR-COMPATIBILITY-AUDIT.md). The full suite passed real screenshot and contract tests. Additional local probes used unchanged original bytes, temporary camera-style variants, and one provided HEIC. No fixture was added to application source and no original was edited.

## Evidence still required

Production exclusive writer/volume/backup inventory; current deployment availability and Discord connectivity; normal-member permissions; actual message delivery and restart recovery; real two-coach consent; approved 15-player roster authority; production legacy Test Mode settings; phone corpus expected values for every scanner; commissioner/Staff endpoint boundary tests; correction policy and completion; independent restore evidence; full authenticated browser journeys. These omissions prohibit a READY recommendation.
