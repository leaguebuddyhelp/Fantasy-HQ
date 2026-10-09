# Mock draft live testing

Use the existing `2k-test` league and its existing Test Mode. Assign actual team roles and sync owners through the existing setup before testing. Do not bind a new parallel league. Initial simulation data is saved in this league. No Discord deployment, bot restart, real trade, week advancement, DM or thread creation has been performed by this implementation session.

Deployment:

1. Run `npm run deploy:commands` with the normal bot deployment environment.
2. Restart the existing bot (`npm start` / the existing process supervisor).
3. Run the channel repair button in `/league setup`. Verify exactly one pinned Live Mock message in Scouting Hub. Repeat repair; the message ID should remain the same.
4. Confirm bot permissions: View Channel, Send Messages, Read Message History, Embed Links, Attach Files, Create Private Threads, Send Messages in Threads, Manage Threads and Manage Messages. The setup repair grants the relevant channel permissions; server-level permissions/role hierarchy must still permit the actions.

Checklist:

1. As an assigned coach, run `/mockdraft`. All 30 picks appear privately in one embed with team emojis, original team, current owner, prospect, position, school, Board rank and AVP. No thread or public draft message appears. Run it repeatedly as different coaches and after a bot restart: all selections, AVP and ownership must stay identical within the league week. After advancing the league week and completing its background simulation refresh, verify a new weekly board is published. Confirm an intraweek trade refresh does not change the command board.
2. As a non-coach, run `/mockdraft` and click START LIVE MOCK. Both reject privately without creating a thread.
3. As a coach, double-click START LIVE MOCK. Only one private room exists for that host. An uninvited coach cannot see it. The host and bot can access it; Discord staff with Manage Threads may access it under normal Discord permissions.
4. Open INVITE COACHES. Options contain configured team coaches only. Page through both invite pages and invite coaches across both pages. Check that access is granted automatically and each controls their assigned team.
5. RUN LOTTERY. All 30 slots appear across three complete order messages. RERUN several times; picks 1–16 vary legally, the three relegated teams stay at or above pick 12, and picks 17–30 retain regular-season record order.
6. Check original-team repeat restrictions using prior real draft slots in settings. A prior No. 1 original pick cannot repeat at No. 1; two prior top-five original picks cannot become a third. Traded ownership must not bypass either restriction.
7. Verify traded pick labels show original → current owner. LOCK DRAFT ORDER. Repeated lock clicks are harmless. Old lottery/rerun controls reject. Invites are closed. Backend ownership changes made separately after locking do not change this mock's ownership.
8. START MOCK twice. Exactly one pick is active. Uncontrolled teams select immediately, without an artificial waiting period. Human clocks start with two minutes.
9. MAKE PICK opens Top 10 Best Available with Board rank and AVP. SEARCH ALL PROSPECTS finds a prospect outside the top ten; search an empty query and page through the full pool. Already drafted prospects appear nowhere in selectable options.
10. Preview a prospect and verify its existing portrait, market range, availability probability and scouting summary where available. Test a prospect without a portrait; the view still works.
11. CONFIRM PICK twice. Exactly one pick commits; the prospect is unavailable immediately. A stale confirmation, wrong coach or participant selecting another team's owned pick rejects. No undo or repick control exists.
12. Allow a human clock to expire. Exactly one TIMEOUT_CPU selection commits. Confirm near expiry to test the human/timeout boundary.
13. PAUSE as host while a human is on the clock. Remaining time freezes and CPU progression stops. A non-host coach cannot pause. Restart while paused, wait, then RESUME; only the saved remaining time is restored.
14. Restart during an active human clock. Its original deadline persists. Restart during CPU progress; selected prospects remain unique and drafting resumes from the next slot. Reactions are posted once using persisted delivery references and message correlation markers.
15. In the test league, use the existing approved/proof-backed trade flow to give one participating team's coach several first-round assets before locking a new mock. That coach gets a human window for every owned slot. Inspect later reactions for acknowledgement of earlier selections and roster crowding.
16. Have a participant use LEAVE MOCK or leave the private thread before their turn. Their team switches to CPU. Remove a team role/sync owners and verify the stale participant cannot confirm a pick.
17. Review all 30 reactions: valid A+ through F grades, four original analysis sentences, distinct openings, value/fit/roster/risk observations, and analytical lower grades. Missing optional prospect fields should not break drafting.
18. Finish pick 30. Status becomes COMPLETED, all clocks stop, and the complete recap and supported awards persist. Multi-pick awards must list the entire team's haul.
19. Keep one participant's DMs closed. All other participants receive all three board pages plus takeaways. Delivery failures are recorded individually. Uninvited coaches receive no DMs.
20. Verify the private room deletes only after recap persistence and all participant DM attempts. Temporarily deny deletion during a test; cleanup remains pending and retries with backoff after permissions return. DMs already delivered are not resent. Backend recap data remains after room deletion.
21. Finalize a regular-season test week through the existing confirmation flow. Within the background refresh interval plus generation time, the active snapshot changes and contains exactly 1,000 simulations. Merely previewing/attempting an unfinished week must not request a refresh.
22. Submit a first-round test trade. Proposed, GM-approved, committee-approved, proof-pending, denied and expired states do not refresh. Only successful backend completion refreshes relevant current first-round ownership. Second-round/future-class pick-only trades do not refresh this class.
23. Interrupt/fail a simulation refresh and verify `active.json` still points to the previous validated snapshot. Restart and verify durable requests retry.
24. Compare players, roster memberships, picks and scouting points before/after mocks. They must be unchanged. Confirm no website mock archive/navigation was added.

Known assumptions:

- Play-in results are projected from current conference seeds unless the existing settings include actual 7/8 losers. No playoff system was added.
- Prior real draft results must be supplied in settings to enforce repeat-pick restrictions; fictional mock results are never used as real history.
- NBA approved 3-2-1 for 2027–2029. The requested 2030+ continuation is provisional until official rules are published: https://www.nba.com/news/nba-board-governors-approve-new-draft-lottery-system.
- Zero-selection prospects have no defined AVP and display “Unselected”; all still remain eligible for human selection.
- Discord delivery is recovered using persisted IDs, nonce enforcement and correlation-marker lookups in the latest 100 messages. Discord side effects assume one running bot process per guild; backend selection commits use a filesystem lock.
- Live Discord permissions, API behavior, DMs and real process restarts still need this live checklist. Automated tests use Discord doubles and actual temporary JSON repositories.

Season/class verification:

- In an isolated test league, verify Seasons 1–4 select CUS01–CUS04 respectively for weekly mocks, live mocks, Big Board and Early Top Ten.
- `/mockdraft` and `/toptenpreview` have no class argument; Start Live Mock opens its room immediately without a class menu.
- Repeat a weekly mock in the same week and verify identical picks. Live lottery reruns remain random.
- Open the website with an obsolete `?class=` URL. Both boards must show the current season, with a season label instead of class tabs.
- Season 5 without installed CUS05 files must report a missing-class error.

Automated regression coverage: `test/season-draft-class.test.js`, `test/season-draft-page.test.js`, `test/mock-draft.test.js`, `test/command-dispatch.test.js`.
