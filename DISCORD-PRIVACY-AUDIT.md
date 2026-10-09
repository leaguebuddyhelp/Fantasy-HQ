# Discord reply privacy audit — October 9, 2026

Scope: all 25 registered slash commands, interaction dispatch and error handling, component and modal workflows, and intentional channel/DM output. Reviewed interaction acknowledgments and source-message updates across setup, schedules, weekly operations, game submissions, scouting, live mocks, upgrades, trades, regular-season and offseason free agency, playoffs, awards, Test Mode, resets, and the Sportsbook. Application changes are local pending deployment.

## Response policy

| Workflow | Visibility |
| --- | --- |
| MyTeam and My Week; upgrade progress, eligibility, history and requests | Ephemeral to the acting coach |
| Mock projection, scouting unlocks and player selection controls | Ephemeral; live draft picks and recaps remain shared inside their private draft room |
| League setup/settings/imports, roster tools, owner assignments, activity-check management | Ephemeral; explicitly published activity checks and league feeds remain shared |
| Week advancement, cleanup, thread recreation, season transitions and confirmations | Ephemeral; actual game threads and weekly Staff reports retain their channel audiences |
| Schedule mine, generation, preview, regeneration and confirmation | Ephemeral |
| Schedule week/team/full and team list/roster | Public league information |
| Website link, promo, open teams, standings, player/reference ratings, statistics, free-agent list, Early Top Ten | Public league information |
| Pending trade negotiation | Participant DMs and a private, non-invitable Submit Trade thread |
| Committee review | Configured restricted Committee channel; individual vote responses private |
| Trade proof, official signings, approved/denied trade announcements | Intentional league channel output, consistent with existing league workflows |
| FA offer construction, conditional cuts, active offers, withdrawals and waiver controls | Ephemeral; official outcomes and Staff proof review remain in their designated destinations |
| Sportsbook accounts, bet slips, confirmations and coach web access | Ephemeral; public board announcements remain shared |
| Test Mode options/results, reset controls and staff decisions | Ephemeral; explicitly selected simulation output can appear in the Staff channel |
| Errors and denied actions | Detailed response ephemeral, including failures of public commands |
| Future or unclassified slash commands | Ephemeral by default |

Autocompletion and modals themselves are personal Discord UI. Their submission handlers must still acknowledge privately, as reviewed here.

## Verified defects repaired

1. **Slash command privacy was an incomplete allowlist.** Most commands deferred publicly, including MyTeam and staff operations. Dispatch now uses the central `src/shared/discord-privacy.js` policy: private by default, explicit public information exceptions.
2. **Public command failures exposed detailed errors.** The common error handler now completes a pending public response with a generic notice and delivers the actual error in an ephemeral followup. Errors after a shared source update never replace that shared source. Private acknowledgment tracking also supports role-refresh failures.
3. **Upgrade history/eligibility could overwrite public panels.** These now reply privately when launched from shared messages, while private pagination updates its existing private panel.
4. **Legacy public Big Board controls could reveal the clicking coach's unlocked intel.** Navigation and prospect selection now use a fresh private response when the source is public; existing private panels still update in place.
5. **Pending trades copied their packages to the shared Submit Trade channel.** Packages now go to a private, non-invitable participant thread. Thread/message references persist for recovery; recovered rooms must have the correct private type and parent. DM or thread failures cannot trigger a public package fallback. Staff with Discord permissions to manage private threads may still access them.
6. **Test Mode option updates trusted source visibility.** Existing private options panels still update in place; public sources receive private responses.

The audit preserved pre-existing branding edits. It did not change league records, delete historical messages, deploy code, or send test messages to real channels.

## Verification

**Final verification: `npm run check` passed in an isolated workspace: syntax checks, TypeScript, and all 650 automated tests, including browser/integration tests.** The first broader run exposed two outdated command-menu/privacy expectations; both were corrected before the clean final run. Logs: `/tmp/lb-privacy-final-check.log`.

84 targeted automated tests passed across privacy policy, interaction errors, scouting, upgrades, simulations, command registration/dispatch, trades, channel setup, free agency and weekly dashboards. Regression coverage includes public and private component sources, public error acknowledgment constraints, private scouting intel, role-verification failures after public acknowledgment, pending trade rooms with closed DMs, room reuse, and rejection of an incorrectly typed room before sending its package.

Read-only Discord inspection of server `1415452215044473036` found two `lb-` channels and no `lb-league-staff` or `lb-trade-committee`. Their production access therefore remains unverified until league setup creates them. Channel setup tests verify restricted role overwrites; weekly Staff report code additionally validates its destination's restrictions before publication.

## Operational limits

- Existing posted messages retain their original Discord visibility. An ephemeral flag cannot retroactively hide a public message. Old sensitive public messages, if any, require Staff review; this audit did not delete history.
- Ephemeral replies do not replace authorization. Existing coach/team ownership, Staff, Committee, season and stale-control checks remain necessary and preserved.
- Private threads are restricted to invited participants and people with Discord permissions to manage them. They are not equivalent to ephemeral replies visible to one person.
- Verify actual click flows in an isolated test league after deployment: MyTeam in a shared channel; upgrade history; scouting unlocks; a denied Staff action; week/cleanup confirmations; and a proposed trade with one participant's DMs closed. Check a second coach's account for unintended visibility. These live two-account checks were not performed during this audit.
