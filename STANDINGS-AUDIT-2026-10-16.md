# Standings and live-mock audit — October 16, 2026

Live mocks now start with the active season’s class automatically. New rooms cannot override it; old class-select messages ignore their selected value. Saved rooms retain their existing class and simulation snapshot.

The modern NBA procedures are the reference: [NBA standings and tiebreak procedures](https://www.nba.com/standings).

## Findings repaired

- The old comparator preferred additional wins when winning percentages matched. Ranking now compares the actual win/game fractions before resolving a tied group.
- Division information was absent from the ranking calculation. NBA team metadata now supplies it, with explicitly configured divisions taking precedence.
- The old tie resolver only inspected head-to-head results, differential and points scored. The new resolver uses separate two-team and multi-team procedures and the applicable division, conference and postseason-opponent records.
- A partially resolved multi-team group previously continued through the same comparator. Remaining groups now restart the appropriate procedure.
- Postseason-opponent eligibility includes all teams tied at the tenth-best conference record, rather than prematurely excluding a tied team.
- Points scored and team IDs previously decided otherwise complete ties. Complete ties are now marked provisional. Commissioner playoff preparation records a random seed once per season, resolves division ties first, then conference ties, and freezes the reviewed seeds. Refreshing, cancelling and reviewing again cannot reroll the draw.

## Record derivation checked

Only finalized, approved, valid scheduled games count. Duplicate matchup records are excluded rather than double-counted. Scores determine winners; roster changes do not rewrite the teams attached to historical games. Corrections recalculate live records. Public Discord and website tables use published weekly snapshots, while staff closeout uses finalized current records.

Administrative scoreless forfeits remain a league policy: they add a win and loss but do not manufacture scoring totals. This differs from recording a scored result in a MyNBA save. Publication timing also means current in-game standings can lead the website until week advancement.

## Limits and validation

No live NBA 2K save or its rule settings were available. Matching modern NBA procedures does not independently prove parity with customized or historical MyNBA standings rules. The existing commissioner seed editor remains available for a verified in-game reconciliation.

Regression cases cover each ranking stage, multi-team restarts, complete-tie draw persistence, unequal games played, division identity, official result eligibility and scoreless forfeits. Mock tests cover automatic season selection, stale controls, override rejection, existing snapshots and full 60-pick AVP markets.
