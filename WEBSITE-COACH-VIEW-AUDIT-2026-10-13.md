# Website coach-view audit — October 13, 2026

## Findings and changes

The main usability problem was the continuous page: 18 top-level feature sections, including the staff workspace, competed for attention. Coaches also saw setup language and administration status that did not help them prepare for a game.

1. **Too many features visible together.** Navigation now shows the selected section. Home shows the short introduction and My Week; league totals sit inside a collapsed “League overview.” Existing section IDs and navigation destinations remain available.
2. **Staff tools visible while locked.** The management workspace, commissioner-name field and Staff navigation now remain hidden until server-validated admin access. An unobtrusive Admin mode link opens the key entry screen.
3. **Typing any key appeared to unlock administration.** Browser access previously depended only on a nonempty string. A read-only `/api/league/admin/session` endpoint now validates the key using the existing website credential policy. Invalid keys stay in coach mode and do not trigger staff data requests. Restored session keys must validate again before tools appear. Existing server authorization still governs each staff action.
4. **No clear way to return to the coach experience.** “Return to coach view” removes the stored session key, hides the workspace and staff navigation, closes an open team dialog, and reloads the season-limited draft view.
5. **The landing page pushed the useful task too far down.** Reduced section padding, smaller headings, a collapsed overview and a clear My Week shortcut make the phone layout shorter. My Week continues remembering the selected team using the existing picker behavior.
6. **Coach-facing empty states described staff setup procedures.** Teams, players and schedule now explain that league setup/publication is pending, without directing coaches through commissioner commands.

The default coach navigation retains My Week, teams, players, schedule, standings, playoffs, stats, awards, progression, news, streams and draft scouting. Public draft access remains tied to the season and phase; a validated commissioner key retains access to all installed classes. No league data or feature was removed.

## Validation

- All **22 website page/API tests passed** in the broad run, covering the new coach workflow plus existing draft, weekly staff, offseason, statistics, news, postseason and navigation pages.
- After the final spacing/overview changes, all **four affected coach/navigation/draft browser tests passed** again.
- JavaScript syntax and whitespace checks passed.
- New regression coverage verifies coach home, focused standings navigation, locked staff deep links, invalid keys, valid unlock, restored-key validation, removal of the session key, and returning to coach view.
- Screenshots were inspected at phone width; automated layout checks covered 390, 768 and 1440 pixels. Navigation checks also cover narrower phone and tablet breakpoints. Screenshot fixtures omit the real logo and live league data; they are layout evidence, not production screenshots.

Evidence logs: `/tmp/lb-coach-view-api.log`, `/tmp/lb-coach-view-browser.log`, `/tmp/lb-coach-view-all-pages.log`, `/tmp/lb-coach-view-final.log`. Screenshots: `/tmp/lb-coach-view-390.png`, `/tmp/lb-coach-view-768.png`, `/tmp/lb-coach-view-1440.png`.

## Scope and remaining limits

This is a local implementation and audit. Nothing was pushed or deployed, and no live Discord/league data was changed.

The website's team picker remains a public, read-only team view. It does not authenticate a coach as that team's owner. Private trades, free-agent offers and waivers continue using the existing authenticated Discord workflows. Admin mode does not replace per-action server permissions or commissioner-only restrictions.

The staff workspace retains the existing management tools. The principal simplification is the coach experience and the validated boundary into administration. Production behavior still needs verification after an authorized deployment.
