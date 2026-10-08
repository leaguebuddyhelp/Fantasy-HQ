# Regular-season Free Agency and Waivers

## 1. Implementation summary

Integrated regular-season offers and Staff-approved waivers into the existing bot, player pool, roster memberships, contract display, transaction journal and audit log. No separate bot, website, player database, cap system, offseason market or permission system was created.

## 2. Files added

- `src/fantasyhq/free-agency-service.js`: persistent offer/window/waiver state transitions and signing resolution.
- `src/fantasyhq/offer-score.js`: screenshot text parsing, scraper-format normalization and deterministic ranking.
- `src/fantasyhq/transaction-locks.js`: shared trade, conditional-release, roster-cut and pending-waiver locks.
- `src/fantasyhq/discord-free-agency.js`: private workflows, proof controls, permanent pin, announcements and recovery.
- `test/contract-images.test.js` and the three supplied original JPG fixtures: real OCR regression coverage.
- `test/free-agency-service.test.js`, `test/discord-free-agency.test.js`, `test/helpers/free-agency.js`: isolated fixtures, service and Discord integration tests.
- `src/fantasyhq/coach-identity.js`: shared current-role and owner verification for team actions.
- This report and live checklist.

## 3. Files modified

`src/index.js`, `src/fantasyhq/repository.js`, `src/fantasyhq/trade-service.js`, `src/fantasyhq/discord-channels.js`, `src/fantasyhq/discord-preseason.js`, `src/fantasyhq/box-score/tesseract-provider.js`, `test/discord-channels.test.js`, and `package.json`.

Also updated `role-ownership.js`, `discord-trades.js`, `discord-player-upgrades.js`, `discord-mock-draft.js`, `discord-schedule.js`, and `discord-trade-block.js` to share team identity checks. Current team roles identify the coach/team; the generic Coach/GM badge alone cannot select a team. Interaction and game-thread upload handlers reconcile a changed actor before reading ownership. Separate online coaches retain their own teams; old trade builders are rejected after reassignment. Existing uncommitted contract-display and valuation work was preserved.

## 4. Data/storage changes

Each existing league gains `free-agency.json` containing windows, offer versions, team-season completed-signing counts, waiver requests, private drafts and delivery receipts. Active targets and release reservations derive from those persisted states rather than independent mutable counters.

Original screenshots live in the existing persistent league directory under `free-agency-proof/`. Official player and roster records remain `players.json` and `roster-memberships.json`. Roster moves, contracts, counters, process state and official audit entries commit through the existing recoverable `trade-transaction.json` journal. Its file allowlist now includes `free-agency.json`.

## 5. Free Agency channel flow

`/league setup` → **Create / repair channels** creates/reuses `lb-free-agency`, repairs one pinned entry and persists its channel/message IDs in existing settings. The pin offers **SIGN FREE AGENT** and **MY ACTIVE OFFERS** and displays the actual default/test clock. The Test Mode chooser can restore one-hour timing without changing any existing deadline. It recovers an interrupted unpinned message and coalesces concurrent setup requests.

## 6. FA browser

Private PG/SG/SF/PF/C selector → primary-position-only player menu, descending OVR, 25 players per page. No whitelist or availability flag. The pool follows the same current active-membership definition used by `player-service.js`. Available and active-window statuses are shown; active deadlines render in the embed using Discord local timestamps, while menu times explicitly state UTC. No bidders, competing contracts or scores appear.

## 7. Contract screenshot/OCR

A private Discord file-upload modal accepts one PNG/JPEG/WebP screenshot, up to 20 MB. Originals are retained before OCR. Contract recognition reuses the existing offline Tesseract engine, English language data and bounded worker queue. It applies EXIF rotation, grayscale and contrast normalization. The supplied 16:9 Association Sign Contract layout now gets focused reads of the four offer-value cells, including highlighted yellow rows and the single white year digit. Whole-screen text remains the fallback for other layouts. Salary Cap/Pending Salary and Promise cannot supply offer fields.

Extracts Salary, Years, Contract Type and Option. Promise is never parsed into offer data or scoring. Missing/unreadable fields are not guessed: the coach can fix extracted details or upload a clearer screenshot before submission. `MINIMUM` is preserved as read; because the picture contains no dollar amount, the confirmation asks for the exact 2K amount and keeps submission disabled until corrected. OCR originals retain `MINIMUM` after correction. Staff may subsequently correct any legitimate screenshot.

## 8. Contract normalization

The winning player receives the scraper's exact contract object shape:

```
{ source, sourceUrl, playerUrl, fetchedAt, currency,
  seasons: [{ season: "2026-27", salary: 6660000, option: null }],
  guaranteedTotal }
```

Options use the existing `PLAYER`, `TEAM`, or `null` values; salaries are integer USD. `3+1` produces four season rows, with the option on the final row. Flat is constant; Front/Back produce annual -/+5% changes based on the starting salary. The schedule interpretation should be compared against the actual 2K salary breakdown during live verification. No salary-cap, affordability, exception, minimum/maximum salary, or league maximum-years policy is imposed; malformed or numerically unrepresentable data is rejected.

## 9. Staff Proof flow

The existing Staff-only `lb-league-staff` channel is designated as FA Proof by default through `discordChannels.freeAgencyProof`; the existing coach-visible trade-proof channel is not used for private offers. A different configured proof channel must also pass the privacy check.

Proof includes player, team, coach, original image, contract fields, submission time, immutable deadline, version and conditional release. **APPROVE**, **CORRECT DETAILS**, **REJECT** require an existing configured Commish/Assistant Commish role. Corrections preserve OCR originals, before/after values, Staff identity and time. Approved/rejected/superseded/withdrawn proofs remain in the audit trail with review controls removed.

## 10. One-hour window

The first successfully confirmed/submitted screenshot creates the player's immutable deadline immediately. Production windows are exactly 3,600,000 ms. Later bids, improvements, corrections, reviews and withdrawals cannot alter that timestamp.

At the cutoff, new submissions, improvements and withdrawals are rejected server-side. A 15-second background sweep and immediate post-review processing resolve eligible windows; pending on-time Staff reviews keep the window in `CLOSED_AWAITING_REVIEW` regardless of Staff response speed.

## 11. Announcement/ping behavior

The first offer posts one announcement with the configured league-ping role, falling back to the existing LEAGUEbuddy Coach role. Additional offers, reviews and withdrawals silently edit that original message. Only player, position, process status, interested-team count and deadline are public during bidding. No reminder countdowns or repeated pings.

Discord references, audit markers, deterministic nonces and delivery receipts support retry/restart recovery without posting another announcement or proof after a lost acknowledgement.

## 12. Improvements/withdrawals

**MY ACTIVE OFFERS** privately shows only that team's contract, review status, deadline and release. Before cutoff, **IMPROVE OFFER** uploads a new screenshot and requires a strictly higher score. One pending version per team/target is allowed. An approved previous version remains binding while the improvement awaits review; only an approved, genuinely better improvement supersedes it. A rejected or corrected-weaker improvement preserves the old approved version.

Withdrawal before cutoff withdraws the team's live versions and immediately frees its target/release reservations. Empty windows close cleanly; a later first offer creates a new process with a new hour.

## 13. Offer Score formula

All math lives in `offer-score.js`:

```
controlledMoney = sum(season salary where option != TEAM)
security = min(0.06, controlledYearCount * 0.01)
option = PLAYER ? +0.02 : TEAM ? -0.02 : 0
structure = FRONT ? +0.005 : BACK ? -0.005 : 0
score = round(controlledMoney * (1 + security + option + structure), 2)
```

Money dominates. Player-option money counts; team-option money does not count as guaranteed/player-controlled. Front/Back modifiers are small and operate after the actual salary schedule, so a back-loaded offer can still win when it pays materially more. Constants are centralized. No coach-facing view, announcement or DM displays numerical scores.

## 14. Tiebreaker

Equal scores use the earliest current qualifying submission timestamp, never approval time. An improvement uses its own later submission timestamp. Persisted submission sequence breaks same-millisecond ties consistently, including after restart.

## 15. Active-target limit

`allowedActiveTargets = min(2, 5 - completedSignings)`, floored at zero. Every submission revalidates the current count. At 4/5, only one target; at 5/5, none. Pending/approved competition remains active until withdrawal, rejection, cancellation, loss, forfeiture or completed resolution releases it.

## 16. Signing limit

Only completed acquisitions increment the team-season count. Maximum five. Losing, rejected, withdrawn and cancelled offers do not count. Waiving or trading never restores a signing slot. Re-signing a previously waived player counts again.

## 17. Conditional releases

The existing roster rule is 15 players. At a full roster, an offer requires an eligible current player as conditional release. The player remains rostered during bidding and is released only when the signing actually commits. Two targets must reserve different players. Losing/rejected/withdrawn processes do not execute a release.

## 18. Transaction locks

A shared helper checks active trades, FA release reservations, roster cuts and pending waivers. Waiver/release selectors omit locked players. Trade preview/submission/final revalidation reject FA-reserved or pending-waiver players. Administrative authoritative roster changes still undergo final ownership/pool revalidation.

## 19. Winner/fallback logic

Once the cutoff passes and all on-time pending reviews finish, the service automatically ranks each team's latest approved offer. One approved offer wins automatically. Staff never chooses/ranks the winner.

Open roster spot: sign. Full roster with valid release: atomic release plus sign. Unexpected full roster or invalid release: reserve the FA, DM the winner, and provide **CHOOSE ROSTER CUT** in private **MY ACTIVE OFFERS** as the fallback when DMs are disabled. The cut deadline is one production hour. Missing it forfeits that bidder and advances down the saved ranking; each fallback needing a cut receives its own hour. If no bidder succeeds, the player returns to normal FA availability.

Imported rosters above 15 must complete Staff-approved waivers down to 15 before the final single-player signing cut. They cannot sign into an oversized roster.

## 20. Contract/transaction integration

No duplicate players are created. Signing adds an active membership for the same permanent player ID, updates the existing player contract, increments the season counter and records `fa.signing.completed` through the common transaction journal. Releases record their own `player.waived` entry containing the prior contract. Player-upgrade request invalidation receives roster movement notifications. Website/Discord contract displays automatically read the same existing format.

## 21. MyTeam changes

The existing single compact dashboard now includes **FA Signings: X/5**, **Active FA Targets: X/allowed**, and a restart-safe **WAIVE PLAYER** button. `/myteam` reads current persisted state each time. Existing roster, salary, draft-pick and schedule display remains.

## 22. Waiver flow

`/myteam` → **WAIVE PLAYER** → eligible current player → review → **SUBMIT WAIVER** → Staff-only Proof → approve/reject. No screenshot or OCR is required.

Approval atomically revalidates ownership/locks, ends the membership, clears the active contract, preserves it in audit history, places the player in the existing FA pool and records the waiver. Announcements ping the league once. Rejection changes neither roster nor contract. Duplicate review cannot repeat the mutation. Pending waivers remain reviewable after a playoff transition.

## 23. Playoff transition

New windows, improvements and waivers require `REGULAR_SEASON`. A window started in regular season may continue its original bidding period, on-time proof review, resolution, cut period and fallback after the phase becomes `PLAYOFFS`; no new player window is permitted then. Pending regular-season waivers can still finish.

Existing Week 15 completion intentionally does not start playoffs automatically; that established behavior remains unchanged. FA observes the actual league phase. Staff-only Test Mode controls exercise the transition without building a new playoff system.

## 24. Restart/recovery

Startup runs a recovery sweep; subsequent sweeps use saved deadlines instead of restarting timers. Window, offer, proof/announcement references, corrections, ranking, winner index, cut deadline, target/release state and delivery receipts survive restarts. Interrupted multi-file mutations replay the existing journal before readers expose league state. Roster mutations are synchronous and serialized within the project's existing single bot/website process; run one application writer against its JSON volume, consistent with the current architecture.

## 25. Tests added

Forty new FA/waiver tests plus an isolated shared fixture cover primary-position browsing, parsing/normalization, score ordering, exact cutoff, immutable/restarted clocks, on-time late review, improving/withdrawing, limits, release/trade/waiver locks, atomic signing and genuine disk-interruption recovery, three-bidder fallback, failed DMs, external pool removal, Staff permissions, announcement privacy and duplicate recovery, native upload/correction/waiver interactions, MyTeam controls, test clock and playoff simulation. Existing channel setup tests were expanded for the additional channel/pin without removing their permission or retry assertions.

## 26. Total test results

Baseline: **364 passed**. FA validation: **405 passed, 0 failed**. Coach identity validation: **410 passed, 0 failed**. Final validation including the supplied contract pictures and MINIMUM confirmation: **413 passed, 0 failed**. Focused FA/channel integration: **49 passed**; focused coach/ownership/trade checks: **21 passed**; final DM builder changes also passed the trade suite. Logs: `/private/tmp/leaguebuddy-fa-baseline.log`, `/private/tmp/leaguebuddy-fa-final-check.log`, `/private/tmp/leaguebuddy-fa-integration.log`, `/private/tmp/leaguebuddy-coach-final-check.log`, `/private/tmp/leaguebuddy-coach-focused.log`, `/private/tmp/leaguebuddy-coach-trades-check.log`, `/private/tmp/leaguebuddy-contract-real-check.log` (42 passed), `/private/tmp/leaguebuddy-contract-final-check.log`.

## 27. Typecheck/lint/build

`npm run check` passed: syntax validation including the new services, `tsc --noEmit`, all existing browser/OCR tests and the complete test suite. The repository has no separate lint/build scripts. The coach identity deployment `584674f8-b1b7-4f05-b881-c4c369f6cd93` completed successfully. Read-only live checks confirmed both current coaches match their role and owner assignment; the FA pin survived the restart. The contract-picture deployment `e216138c-c7ce-41e8-86ac-0a3354fd135c` also completed successfully. All three original images were read again with the deployed Linux OCR, and their four extracted fields matched the expected results exactly. This live verification was read-only and made no roster or contract changes.

## 28. Required Discord setup/repair

Use `/league setup` → **Create / repair channels** for idempotent ongoing repair. It adds the FA channel/pin and designates Staff-only proof, preserving existing channel IDs. Bot needs existing channel setup privileges, View/Read/Send/Embed/Attach for proof and announcements, Manage Messages to pin, and Mention Everyone to notify the configured league role when that role is not mentionable. No new slash-command registration is required: controls use the existing interaction router.

Live setup is complete for `2k-test`: [Free Agency pin](https://discord.com/channels/1516463916933189742/1557501763148582912/1557501766545707059) and [Staff-only proof](https://discord.com/channels/1516463916933189742/1556644589299826690). Two consecutive ensures reused the same pinned message. All 30 compact MyTeam embeds fit Discord limits; the largest was 2,164 characters. The live pool contains 117 free agents (PG 28, SG 27, SF 19, PF 21, C 22). No live bids, signings or waivers were simulated. Live Discord verification confirmed all 30 team roles are mapped, with separate Clippers and Lakers coaches and no ownership conflicts.

## 29. Required migration

No player, roster or contract migration is required. Missing FA state defaults to empty; process state is saved on first action. Existing regular-season signing counts start at zero for this new system. The journal allowlist update ships with the code. Keep the existing `/app/data` Railway volume attached for screenshots and state.

## 30. Required bot restart

The deployment must restart the bot to load the new `fa:` interaction handlers and background sweep. Existing accepted processes resume from their saved timestamps; no separate FA daemon is needed.

## 31. Exact live test checklist

Use a separate Discord test server and a unique league ID with the existing Test Mode. Do not run destructive practice signings/waivers against the production league. Test Mode uses the same real mutation paths inside its own existing league directory.

1. Invite the existing bot to the test server and register its existing guild commands there if needed. As Staff, run `/league create league_id:fa-test league_name:FA Test test_mode:true`. Use a fresh unique ID if `fa-test` already exists.
2. Run `/league setup` → **Create / repair channels**, then repeat repair. Verify one FA pin, read-only coach access to FA/announcements, and Staff-only proof. Assign the existing Commish/Assistant Commish role to the tester.
3. Import rosters/FA through the normal setup flow, confirm the schedule (`/schedule generate`, `/schedule confirm`), enter preseason and start regular season through `/league setup`. Test Mode permits vacant teams. Assign yourself one team for testing `/myteam`; leave other practice teams vacant.
4. Open **SIGN FREE AGENT** as Staff. Select **USE 60s TEST CLOCK** in the private Test Mode team chooser (if the clock is already shortened, the same control says **RESTORE 1h CLOCK**). This affects new test windows and their future cut windows only; production remains one hour.
5. Choose your own/vacant team, PG, and a player. Verify a PG/SG is listed only under PG, ordering is descending OVR, pagination reaches all FA players, and no competing team/contract appears.
6. Upload a real NBA 2K offer screenshot. Compare Salary, Years, Structure and Option to 2K. Test Flat, Front (-5%), Back (+5%), 3+1, None, Team and Player options. Ignore Promise. **FIX OCR DETAILS** is available for unreadable fields; confirm and choose a conditional release when full. The roster must remain unchanged during bidding.
7. Check that the first accepted offer creates its deadline immediately, posts one Coach/league-role ping and Staff-only proof. In Proof, try **CORRECT DETAILS**, then **APPROVE**; verify the original OCR and correction audit. Use a Coach without Staff roles to confirm review buttons are denied.
8. As the same tester using another vacant team, submit a competing screenshot for that player. Verify the existing announcement's interested count increases without a second ping or deadline change. The first team's private active view must hide the second team's amount/identity.
9. Approve the original version, submit a stronger improvement, and verify the old version stays valid while pending. Reject the improvement and verify the old offer survives. Test equal/worse replacement rejection; approve a better version and verify it supersedes the old one without extending the timer.
10. Before cutoff, withdraw an offer through **MY ACTIVE OFFERS**. Confirm immediate target/lock release and a silent interested-count edit. Try two targets with the same release player: reject. Try a third target: reject. Try trading/waiving a reserved release player: reject.
11. Leave one on-time screenshot pending until after the test deadline. New offers/improvements/withdrawals must fail, while the FA remains unsigned awaiting Staff. Approve/reject the pending proof after cutoff, then verify automatic resolution.
12. Verify the winner's roster, existing player ID, scraper-format contract, FA count, release's cleared contract and immediate FA availability. Confirm one public final contract announcement and private result notifications, with no numerical score.
13. Test `/myteam` → **WAIVE PLAYER**. Submit, reject once (no mutation), then resubmit/approve. Verify no screenshot required, old contract retained in audit, public waiver ping once and immediate FA eligibility. Re-signing the waived player increments the count again; the waiver never restores a slot.
14. In the isolated test league, waive down to 14 players. Submit offers for A and B without a conditional cut. Leave A pending Staff review; approve B and let B sign to fill the roster to 15. Approve A after its cutoff to trigger its winner cut window. Verify its saved cut deadline, winner DM and private **CHOOSE ROSTER CUT** fallback. Disable DMs to test fallback. Allow the first and second bidders to miss cuts; verify each gets its own test cut period and the next eligible bidder signs. Oversized imported rosters need Staff-approved waivers down to 15 first.
15. Complete five test signings. At 4/5, only one active target is allowed; at 5/5, none. Losing/rejected/withdrawn attempts do not increase the count.
16. Start an offer and pending waiver, then use **TEST PLAYOFF TRANSITION** in the private Staff Test Mode chooser. New windows, improvements and waivers must fail; existing bidding/review/cut/fallback and the pending waiver may finish. **RESTORE TEST REGULAR SEASON** returns the isolated test league for further practice. These controls are denied outside Test Mode.
17. Restart the test bot with an open offer, then with a closed pending review/cut. Verify original deadlines, references, target/release locks and ranking remain unchanged. Repeat approvals and sweeps: one acquisition, one counter increment and no duplicate announcement/proof/ping.
18. In the isolated test data only, move an offered FA into an official active roster through an authoritative roster change. The next sweep must cancel the FA process, invalidate offers, unlock targets/releases, edit its announcement and notify coaches. Do not edit production roster files for this test.
19. Verify current coach/team recognition with `/myteam`, `/schedule mine`, Build a Trade and the FA pin. Reassign a team role, then retry immediately: the action must use the new current team, or reject a conflicting/stale workflow. Use separate coaches to verify each manages only their own team. The deployed league `2k-test` already has Test Mode enabled; Staff therefore see existing test controls. Live verification found `freeAgencyTestWindowSeconds: 60`; that current setting was preserved. New windows in `2k-test` therefore use 60 seconds, while each existing window retains its saved duration. One-hour timing is the default; accelerated timing requires the explicit test-clock setting. Keep practice roster mutations in the separate test league. A league with Test Mode disabled must show no test-only controls.

## 32. Remaining issues and verification limits

- The currently deployed `2k-test` league has Test Mode enabled and its test clock is currently 60 seconds. Those existing settings were preserved; use a separate league for practice acquisitions/waivers.
- The three supplied 4K contract images now pass real offline OCR regression checks: Payne $3.90M / 1+1 / Flat / Team, Yabusele MINIMUM / 1 / Back (+5%) / None, Thomas $6.66M / 3+1 / Front (-5%) / Player. MINIMUM requires an exact dollar amount. The pictures do not show the complete annual salary schedule; Staff should still compare generated future salaries with 2K. Other camera framing/layouts may require manual correction.
- Imported rosters above the existing 15-player limit require Staff-approved waivers to make room. The system does not silently discard extra players.
- The established week controller finishes Week 15 without automatically entering playoffs. This implementation preserves that policy and gates FA from the actual phase.
- The app uses its existing single-writer JSON architecture, not a distributed multi-replica transaction database. Deployment must keep one application writer against the persistent volume.
- Simulated acquisitions/waivers were confined to isolated test fixtures. Human Staff must verify legitimate 2K proof in live use.

READY WITH WARNINGS
