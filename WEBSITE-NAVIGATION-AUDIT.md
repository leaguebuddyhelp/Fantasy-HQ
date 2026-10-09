# Website visual and navigation audit — October 9, 2026

Reviewed the 18 main page sections, header, phone navigation, section links, draft navigation, news filters and Staff entry points. The audit used source inspection, local desktop/phone screenshots and isolated browser flows. It did not change live league data or deploy changes.

| Finding | Change |
| --- | --- |
| Sixteen header links wrapped across multiple rows; the desktop header measured 161px high. | Six main entries: Home, League, Stats, News & Live, Draft and Staff. Desktop header now measures 78px at 1440px. |
| No current-section indicator. | Selected destinations use `aria-current` and highlight the containing menu. |
| Phone menu was an undifferentiated list; its JavaScript and CSS used different breakpoints. | Expandable groups, one open group at a time, consistent 1100px breakpoint, bounded scrolling, 44px targets and keyboard Escape/focus handling. |
| News appeared before the coach's weekly work; Staff interrupted the draft content. | Page order now follows weekly/season work, stats, news, draft and Staff. Existing sections and IDs are preserved. |
| Common actions required searching the header. | Home shortcuts for My Week, Schedule, Standings and Draft Room. |
| Prospect stats and scouting methodology were not discoverable from the header. | Draft menu includes Draft Room, Early Top Ten, Big Board, Prospect Stats and Scouting Guide. |
| News had eight cramped inline filters. | Collapsible filter panel with a responsive grid and styled controls. |
| Website access required finding or remembering the URL. | `/website` returns an embed and Open Website button, using the configured public URL or Railway domain. Production rejects localhost and credential-bearing links. |

Verification: 11 tests passed across command dispatch, website links, navigation, news/streams, weekly dashboards, player/team stats and existing usability flows. Navigation was checked at 320, 390, 768, 1024, 1100, 1101 and 1440px, including menu bounds, existing destinations, keyboard focus, Escape, mobile dismissal and active links. JavaScript syntax and whitespace checks passed. Screenshots and test output are saved under `reports/website-navigation/2026-10-09/`.

The site retains its existing single-page structure; all content remains available through scrolling and existing deep links. Staff authorization remains enforced by the existing backend. Dense Staff forms and large statistics tables are candidates for a later focused redesign. Fixture tests do not establish production data correctness or replace testing with real coaches.

Not deployed. `/website` also requires guild command registration after deployment.
