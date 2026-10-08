# Discord channel audit — October 8, 2026

The live server had 20 managed league text channels. Two postseason channels lacked `lb-`. The category, default text/voice channels, and features channel also lacked the prefix. Most channel positions followed creation order; only Player Upgrades had an explicit placement rule. Free agency and postseason feeds had been appended at the bottom.

Setup now enforces the following order under `lb-league`, adds a purpose topic to every managed text channel, and reuses existing IDs/messages/history. Legacy postseason names and `lb-activitycheck` migrate in place. Other existing server channels/categories receive the `lb-` prefix too. Time off is last in the league category. The layout runs once on deployment and can be repaired by the existing channel setup control.

| Order | Channel | Purpose / access |
| --- | --- | --- |
| 1 | lb-announcements | Important announcements; public read-only |
| 2 | lb-available-teams | Open teams and joining; public read-only |
| 3 | lb-chat | Coach/GM league conversation |
| 4 | lb-game-threads | Private matchup threads and photo submission |
| 5 | lb-activity-check | Activity check responses |
| 6 | lb-standings | Official standings, published on week advancement |
| 7 | lb-stats | Official leaders and shooting percentages, published on week advancement |
| 8 | lb-playoff-stats | Postseason statistics |
| 9 | lb-season-awards | Official award winners |
| 10 | lb-free-agency | Free agent offers, proof and waiver controls |
| 11 | lb-player-upgrades | Eligibility, earned upgrades and requests |
| 12 | lb-scouting-hub | Draft classes, scouting, mock drafts and live mocks |
| 13 | lb-trade-block | Team trade advertisements |
| 14 | lb-submit-trade | Trade builder and submission |
| 15 | lb-trade-proof | In-game execution proof |
| 16 | lb-trade-counts | Completed trades and remaining limits |
| 17 | lb-approved-trades | Approved/completed trade announcements |
| 18 | lb-denied-trades | Rejected decisions and reasons |
| 19 | lb-trade-committee | Private Staff/Committee review |
| 20 | lb-league-staff | Private weekly operations, pending work, simulation and reset controls |
| 21 | lb-time-off | Coaches/GMs post team, absence dates, return date and rescheduling needs |

Coach and GM roles now have consistent access to coach-facing channels. Staff and Committee privacy remain distinct. Feed channels remain read-only for coaches/GMs. Time off is a manual coordination channel: posting does not automatically pause deadlines or approve forfeits.

## Consolidation recommendations

- `lb-general` overlaps with `lb-chat`. Move ongoing league conversation to `lb-chat`; archive the old general channel after reviewing its history.
- `lb-features` can serve as a help/reference channel. Keep it if its content is useful; otherwise incorporate the useful instructions into pins/topics and archive it.
- Approved and denied trade channels can eventually become one trade-results feed. This requires changing publication destinations and migrating history, so this audit preserves both working feeds.
- Trade Counts could eventually be a second pin in Submit Trade. Its automatic count refresh currently targets its own configured channel; move the pin and update that routing together before retiring the channel.
- Keep Trade Proof separate while proof submission and execution are routed there. Keep Committee and Staff separate for their different access rules.
- A separate schedule channel is unnecessary: private matchup threads and website schedules already supply the workflow.
- No additional new feed channels are needed beyond the requested time-off channel. Avoid creating duplicate website destinations solely to mirror every page.

No channels or historical messages are deleted by this change. Automated tests verify idempotent migration, full order, topics, privacy, GM access, legacy ID reuse, missing-channel repair and time-off placement.

## Deployment verification

`npm run check` passed all 509 tests, with zero failures or skips. The changes were deployed to Railway production. A direct Discord API read confirmed zero channels without `lb-`, all 21 league text channels in the intended order, 21 purpose topics, and `lb-time-off` as the last league channel. Existing league channel IDs were reused; one new time-off channel was added.

## Available teams — ownership updates

The Available Teams channel now has one persistent pin with all thirty NBA teams grouped into six East/West division fields. Each row displays the team emoji, abbreviation and assigned owner, or Open. Mentions display owners without sending notifications. The `/availableteams` command scans the current Discord roles and posts only unowned teams in one embed.

Assignment/removal and member/team-role changes refresh the pin through the existing ownership reconciliation callback. A periodic feed refresh provides recovery after failed Discord requests. Concurrent ownership changes during an in-flight pin edit are checked again before the refresh finishes. The existing pin ID is preserved; deleted or unpinned pins are repaired by the standard feed service.

Available Teams deployment verified: all 513 tests passed. Discord contains exactly one Available Teams pin with one embed, six conference/division fields and five teams per division. The live scan showed 28 available and two owned teams. `/availableteams` is registered, and Railway reports the deployed bot healthy. Actual owner assignment/removal was covered by automated fixtures; no real owners were changed during verification.


## Additional channels in the current implementation (not yet deployed)

The current layout contains 25 managed channels. News follows Announcements; Streamlink follows Games; Power Rankings follows Standings; Player of the Week follows Season Awards. These additions reuse persisted channel/message IDs and permanent-post receipts. News permits audience reactions while keeping publishing controlled by the bot. `lb-time-off` remains last. The older table and deployment notes above describe the previously verified live layout.
