# LEAGUEbuddy complete testing walkthrough

This guide follows the code scanned on October 6, 2026. Use a disposable league for tests that change rosters, games, trades, or upgrades. Test Mode supports one actual Discord account; it does not give that account multiple real team ownerships.

## 1. Start here: your existing league versus a full fresh test

Your server was bound to `2k-test`, season `1`, regular-season Week 1 with Test Mode enabled at the time of this audit. You can test games, trades, scouting, upgrades, and live mocks there. No Week 1 game records were present at activation, so run `/games create` and confirm to prepare that week’s matchup threads before the game tests. To test creation, SETUP, and preseason as well, create a **new** league using the instructions below.

1. Run `/admin status` and save the current league ID and season ID.
2. Use a test Discord server where possible. Creating a league also changes the server's binding. Test Mode data is real persisted data within that league.
3. Confirm you have **LEAGUEbuddy Commish** or **LEAGUEbuddy Assistant Commish**. Manage Server also permits most administrative operations, but upgrade approvals specifically require a configured staff role.
4. Hold **exactly one** NBA team role and confirm `/myteam` shows that team. Leave the other teams vacant for solo tests. Use `/league roles` to repair missing roles; use `/league setup` and its channel repair control for missing channels/pins.
5. Allow direct messages from the server if you want to verify the live-mock recap DM.

For local startup, from the project folder:

```sh
npm run check
npm run deploy:commands
npm start
```

`npm run check` runs syntax checks, TypeScript, automated service tests, and website/browser tests. Its fixtures use temporary data rather than your bound league. `npm start` runs both bot and website; run only one copy. `npm run start:web` is the website-only alternative.

Use the URL configured in `WEBSITE_URL` (normally `http://localhost:3000` locally). Check `/health`, then Home. Website Admin uses `WEBSITE_ADMIN_KEY` from your local `.env`; enter it in the Admin key field, not in chat. Users on other computers need a reachable configured website URL for profile/review links.

## 2. Create a fresh solo league and test SETUP

Choose a unique unused ID:

```text
/league create league_id:solo-test-01 league_name:Solo Test season_number:1 test_mode:true
/league setup
/league status
/roster status
/team list
```

Expected: league creation imports team rosters and free agents, binds the server, and prepares league roles/channels. The setup checklist reports remaining requirements. If an import failed, fix that issue before proceeding; `/roster import` is a replacement operation, not a necessary first step after a successful create.

- [ ] Assign your own single team through its Discord role or `/team assign`, then verify `/myteam`, `/team roster`, and `/schedule mine` when a schedule exists.
- [ ] All other teams may remain vacant in Test Mode. Adding a second team role to yourself must create a conflict rather than silently giving you two teams.
- [ ] Run `/league settings test_mode:true` while in SETUP; the settings embed explicitly labels Test Mode. This normally turns off the all-owner requirement unless you explicitly supply `require_all_owners`.
- [ ] Generate a schedule from the setup checklist or `/schedule generate`; browse the pending preview, regenerate it, then confirm the intended schedule.
- [ ] Check `/schedule preview`, `/schedule full`, `/schedule team`, and `/schedule week week:1`. Saved schedules have 15 weeks, 14 games per week, 210 games total, one bye per team, and conference matchups.
- [ ] Click **Enter preseason** or use `/setup activate`. Missing required setup data must prevent activation.
- [ ] In preseason, review roster validation on the website or setup panel, then click **Start regular season** and confirm. Week 1 becomes active and game threads are created.
- [ ] Repeating the start confirmation must not duplicate the season or its game results.

Test Mode changes through `/league settings` are **SETUP-only**. For a separate normal-league test, create another disposable league with `test_mode:false`; vacancy permission alone must not enable solo controls. Keep normal leagues in normal mode.

## 3. Website and read-only Discord features

Test the website tabs on desktop and a narrow/mobile window. Refresh a player/prospect deep link and use browser Back. Check empty states before any game has been finalized.

| Area | Actions | Expected result |
| --- | --- | --- |
| Home | Refresh, inspect league summary and phase/week | Correct bound league and season |
| Teams | Search/select team, open roster/player | Correct current owner and memberships |
| Players | Search, filter, sort, open profile | Current league players; edits reflected |
| Stats / Team Stats | Filter/search/sort, open game history | Official finalized games only; useful empty states |
| Schedule | Browse weeks, own/team schedules, game links | Saved matchups, dates, byes, status |
| Standings | Both conferences, select team | Correct W/L, GP, percentages and points |
| Draft | Choose each CUS01–CUS04, preview and big board, search/filter/open profile | Correct class, rank, portrait and profile links |
| Admin | Wrong key, correct key, operator name, refresh | Wrong/missing key cannot read protected data or mutate records |

In Discord:

- [ ] `/ratings team`, `/ratings player`, `/ratings top` with and without position filters, `/ratings freeagency`.
- [ ] `/player` autocomplete/profile, `/myteam`, `/team list`, `/team roster`, `/freeagents` pages and position filters.
- [ ] `/toptenpreview draft_class:<each class>`: browse prospects, Full Profile, correct portrait/class.
- [ ] `/bigboard`: all pages, previous/next boundaries, player profiles.

Ratings commands read the source ratings snapshot. League roster/player edits should change the league views without rewriting that source snapshot.

## 4. Website Admin edits and validation

Perform these on the disposable league before recording important game results:

1. Unlock Admin and enter your commissioner/operator name.
2. Open a league player; edit supported fields, save, refresh, and compare the Discord `/player` result.
3. In roster tools, add a free agent, move a player between teams, remove a player back to free agency, then verify both roster views. Restore legal rosters afterward.
4. Bulk-edit a roster and save. Invalid numbers, unknown players, and duplicate membership must show errors rather than partial silent changes.
5. Preview a team import. Review the differences before Apply. Try a stale preview after changing the roster; the server must protect against stale writes. Applying an import can replace your test team's roster data.
6. Review Data Issues and Audit Log after each write. Non-blocking warnings and blocking roster/setup issues should be distinct.
7. During preseason, test validation failure with an invalid roster, restore it, and repeat validation before starting the season.

## 5. Solo game testing: one account, both real box scores

Run `/games create` only when you intend to confirm replacement of the active week's threads. Existing game history and screenshots are preserved. If linking an existing private thread, use `/game setup week:1 team:<scheduled team>` inside that thread.

1. Open your team's active-week matchup. Staff can access other test matchup threads as needed.
2. Set the **NBA 2K game date** using the matchup control. Enter just a month and day, such as `Nov 18`, `Dec 19`, or `Oct 24`; no year is required. Upload actions must remain blocked until the date is set.
3. Play or simulate the scheduled matchup in NBA 2K with the corresponding league rosters. Capture **one full team box-score screenshot for each team**, including the scoreboard and all required rows. These must match this scheduled game; arbitrary sample images will fail validation.
4. Click **🧪 Test as [first team]**. Upload that team's screenshot in the same private thread.
5. Wait for the `1 / 2` acknowledgment. Click **🧪 Test as [second team]** and upload the second team's screenshot.
6. Both uploads come from your actual account, but retain separate team identities and explicit staff test authorization. There should be one complete `TEAM_SIDES` submission, not two unrelated submissions.
7. Watch extraction and validation. Clean results finalize the game and post a green **✅ GAME APPROVED** thread embed with the final score; the matchup card also turns green. Website review approvals post the same signal. Retries do not duplicate the notice. Uncertain results go to review rather than inventing a score.
8. Compare final scores and player lines with the screenshots. Verify `/standings`, `/stats player:<player>`, `/teamstats team:<team>`, and website standings/stats/history.
9. Check DNP players: they do not receive a played-game stat line. Retrying extraction or the same finalization must not double-count results.

The solo buttons require **current staff permission and explicit Test Mode**. They accept your own team or a vacant team. A team owned by another person must submit its own side. Assigning a real owner before an upload or before finalization invalidates the solo override for that side.

**Staff Submit** is still available for uploading both screenshots together. It produces validated official results, but does **not** earn the two-coach game credit used for player upgrades. Use the two **Test as** sides for the upgrade test below.

### Failures and review

- [ ] Upload a non-image, extra screenshot, wrong-team image, incomplete score table, or inconsistent/tied scoreboard. No official stats should be written until validation passes.
- [ ] Cancel a partial submission and start again; prior originals/history remain available.
- [ ] Retry extraction from stored images. Review can be required with either configured OCR provider; image quality matters.
- [ ] Open the provided website review link, unlock with the Admin key, inspect originals, correct uncertain fields/player matches, revalidate, and approve only a clean result.
- [ ] Reopen the final game: further score uploads/edits must be locked.
- [ ] Restart the bot after a partial upload and verify it can continue using the stored originals.

### Fair Sim, forfeit, CPU, and advancement

- [ ] Use Fair Sim: staff can record confirmation; normal coaches need the applicable coach approvals. Recording a decision alone does not produce scores or stats.
- [ ] Record a forfeit/concession. A normal coach cannot award themselves a win; staff may record the decision. Official numeric results still require validated screenshots.
- [ ] Inspect CPU information. Explicit Test Mode labels test matchups; a normal league with vacant teams correctly labels CPU matchups.
- [ ] `/week advance` must report unresolved games and block ordinary advancement until the active week is complete.
- [ ] In a disposable solo league, `/week advance force:true` presents a confirmation and records unresolved games. It does **not** fabricate results. Use it after completing your own matchup when testing earned upgrades across four weeks.
- [ ] After confirmed advancement, the next week is active and schedule/game-thread controls update. Duplicate/stale confirmations must not advance twice.
- [ ] `/games cleanup week:<completed week>` requires confirmation and removes Discord threads while preserving records/media/stats. The cleanup command can also target unfinished weeks, so use the completed test week for this check.

The server also exposes protected APIs at `/api/league/admin/week`, `/api/league/admin/game-threads`, and `/api/league/admin/game-cleanup`. The current website does not render dedicated buttons for those operations. Their confirmation/mutation paths are covered by the automated suite; use Discord for the manual workflow. For a read-only API check, open browser DevTools on your local website and run:

```js
const testAdminKey = prompt('Website Admin key');
for (const endpoint of ['week', 'game-threads', 'game-cleanup']) {
  const response = await fetch(`/api/league/admin/${endpoint}`, {
    headers: { 'x-leaguebuddy-admin-key': testAdminKey }
  });
  console.log(endpoint, response.status, await response.json());
}
```

The bot must be running for these APIs. Repeat in an unauthenticated private browser session without the header: protected endpoints must return 403. Do not manually call their POST confirmation endpoints against a league you want to preserve.

## 6. Player upgrades with one account

Keep your one actual team assignment throughout this test. Hold a configured Commish/Assistant Commish role to review your own test request.

1. Run `/upgrades`; inspect eligibility and history. During regular season, a qualifying New User entitlement can be available without four games.
2. Use the pinned **REQUEST UPGRADE** control in Player Upgrades. Select a source, player, category, and allocations. Normal allocations allow at most five total points with +1 to +3 per attribute.
3. Review, go Back/Edit, then submit. In the ledger, reject one request and confirm that no player update/balance spend occurs.
4. Submit another eligible request, approve it, and test the approval modes: **NO CHANGE**, **OVR CHANGED**, **BUILD CHANGED**, and **BOTH CHANGED** across separate eligible requests. Compare stored OVR/build and trade value after approval.
5. To earn a normal game upgrade, complete **four distinct scheduled official games for your own team** using both solo **Test as** sides. Advance between weeks; if your team has a bye, advance past it. Four games must belong to your current ownership tenure. Vacant teams do not earn a fictional owner tenure.
6. At the fourth qualifying game, inspect `/upgrades` and the earned notification. Test the Special choices after the four-game requirement; New User upgrades cannot use a Special.
7. Check the two-completed-upgrades-per-player season cap, category reuse restrictions, one Special per team/season, and balances/history. Replaying a finalized game must not award another credit.
8. On the disposable league, test ownership changes after creating a pending request. Stale requests/tenures must expire or be rejected rather than transferring another coach's entitlement.

This uses real final games and the regular award rules. There is no command that grants arbitrary test credits or bypasses upgrade eligibility.

## 7. Trades: GM decisions, committee, proof, processing

During Weeks 1–9, go to the pinned **Build a Trade** panel. Leave counterpart teams vacant for solo testing.

1. Build a two-team player swap. Use similar trade values and keep legal roster sizes. Inspect the preview and each team's package.
2. Add/remove assets, first-round picks and protections; use menu pagination and Add Third Team, then remove it. Invalid roster/value packages must disable submission.
3. Submit. Use the counterpart GM controls sent to you for the vacant team. Staff Test Mode permits these vacant-team responses; it cannot respond for an actual online owner.
4. **Deny** one proposal. For another, **Counter**, edit the package, resubmit, and check the version/timer reset. Old buttons must be stale.
5. Approve a valid version. With no independent real committee voters, Test Mode displays five virtual reviewer controls. Your account may also have the committee role; being an involved coach should still trigger the solo fallback.
6. Test three virtual approvals to reach majority and, on a different proposal, three denials. Only staff in explicit Test Mode can use virtual votes. If independent real committee voters exist, real committee voting remains in use.
7. Approved trades create a proof thread. Upload one actual trade screenshot. Staff reviews the proof; test rejection and then acceptance on separate eligible proposals.
8. Check the final roster memberships, pick owners, team trade counts and audit log. Assets should move once, only after the required processing step. Repeated approval clicks must not apply the trade twice.
9. Try offering an asset already moved by a completed trade; stale proposals must be invalidated or rejected. Keep an expired proposal to observe its 24-hour deadline, or use the automated deadline tests instead of waiting.
10. New proposals after Week 9 must be blocked; existing submitted workflows follow their preserved eligibility and deadlines.

With real people, each actual coach responds for their own team, involved coaches are excluded from committee voting, and an involved coach supplies proof. Nonparticipants do not gain permission through Test Mode. Staff proof simulation is limited to a vacant participating team.

## 8. Scouting and mock drafts

### Scouting

- [ ] Run `/scout position:<position> prospect:<autocomplete choice>` in an active regular-season week.
- [ ] Inspect each reveal in order: Draft Grade, OVR, Potential. Each reveal costs 10 points, from a 60-point weekly allowance.
- [ ] Verify unlocks persist, an already completed reveal is not charged twice, and insufficient points block the next reveal.
- [ ] Advance the league week; points reset without rollover. Prospect browsing remains separate from private scouting unlocks.

### Regular mock

1. Run `/mockdraft draft_class:1`, then repeat for 2, 3, and 4.
2. Each result should be one 30-pick embed with team emojis. Repeating the same class in the same league week should return the same projection.
3. Verify all picks are unique and team fit/value affects selections without huge CPU reaches.
4. After a week transition and successful projection refresh, repeat. Weekly changes are allowed; changing classes must not overwrite another class's cache.

### Live mock

1. Click the pinned live-mock Start control. It prompts for CUS01–CUS04; select a class and check the room's class label.
2. Preview the **base order** before the lottery. Choose that order; **Start Draft** must appear.
3. In another mock, run the lottery. The single 30-pick lottery embed should offer **Start Draft** and **Rerun Lottery**. Reruns are random and must not immediately repeat the same order.
4. While still in setup, click **TEST: CONTROL VACANT TEAMS**. Confirm **SOLO CONTROL: ON**, lock the intended order, and start.
5. Vacant teams now give the host the human selection flow. Your actual assigned team remains your own. A real owner's team is never taken over; invite that coach before locking if they want to participate.
6. Check the on-clock public message beneath the last pick; open its selection controls. The embed displays ten prospects while the dropdown includes up to 25. Test more pages/search, position filters, portraits and confirmation.
7. Confirm one pick; a duplicate/stale confirmation must not pick again. Choose another prospect, cancel/back, then confirm a different one.
8. Pause/resume the draft, then let a human clock expire once. Timeout must make exactly one CPU selection. Turn solo control off to exercise normal CPU progression for vacant teams.
9. Finish all 30 picks. CPU picks should stay within the configured market reach windows, with varied useful grades/storylines.
10. Check the **same single 30-pick recap embed** in the draft room and your DM. Recap portraits are unnecessary; live pick portraits remain. Review cleanup and DM failure/retry handling if DMs are disabled.
11. Start a new mock in a different class; old finished controls should be inactive. Restart while paused/active to verify persisted state recovery.

## 9. Verify normal online behavior

The automated suite uses distinct identities for owner authorization, private threads, GM decisions, committee exclusions, pick ownership, race handling, and stale controls. Run `npm run check` after changes.

For a real Discord acceptance test with another person, use a separate normal league or disposable setup with `test_mode:false`, and make the second person the owner of a different team. Confirm:

- [ ] They see only the appropriate private game/trade/live rooms and their own ephemeral controls.
- [ ] Each coach uploads their own game side; wrong-user/wrong-thread uploads are rejected.
- [ ] You cannot make their trade decision or confirm their live pick, including with staff solo controls.
- [ ] Independent committee members get their voting controls; involved coaches cannot vote.
- [ ] Each invited participant receives the finished mock recap when DMs are allowed.
- [ ] A non-staff member cannot repair channels, advance weeks, clean threads, use virtual reviewers, or simulate game sides.
- [ ] A normal league that permits vacant teams still uses CPU rules and has no solo Test Mode controls.

One account can exercise the implemented workflows in Test Mode. It cannot visually prove what a second person's Discord client displays; the distinct-identity automated tests cover server-side boundaries, and this short two-person pass covers actual Discord delivery/privacy.

## 10. Finish and record results

Run `/admin bind league_id:<saved original ID> season_id:<saved original season>` to restore the binding if you created a temporary league in your existing server. Discord roles/channels are shared server resources; confirm the original team's role and refreshed panels afterward. Do not delete a league to restore a binding.

Record failures with: league/season/week, command or button, game/trade/mock ID, expected versus actual result, screenshot, and relevant terminal error. Avoid tokens and Admin keys.

Some configured fields are not full workflows: a playoff-team setting does not implement a playoff engine. The game deadline setting is stored/displayed, but the actual week-thread clock currently uses 48 hours. Result-confirmation and commissioner-approval settings are also stored/displayed; the implemented result gate is validated screenshots and review when required, rather than separate configurable post-game approvals. There is no actual NBA 2K game execution inside the bot, no full real draft execution from the mock, and no playoff bracket simulation implemented. Test the present features above rather than treating those missing systems as Test Mode failures.

## New complete practice run

From Staff **Test Mode → Run Simulation**, select **Complete season + offseason**, **Keep current rosters**, and **Summary only**. All stages use the isolated league copy. After rollover, run **1 week**; then restore **Starting state**. Use **More Options → Restore Checkpoint** to return to an offseason stage, and use Pause/Resume to stop between completed stages. **Every game and event** displays labeled test events in Staff.

For the new photo importer, upload a HEIC/JPG/PNG, inspect the normalized preview, and choose **Add matched OCR fields for review**. Verify that manual edits remain, conflicting or unreadable fields remain unresolved, and applying suggestions removes the previous confirmation. Save review progress before preparing the final confirmation. The stored original is preserved.

Detailed implementation and remaining production checks: [Complete implementation checklist](COMPLETE-IMPLEMENTATION-CHECKLIST.md).
