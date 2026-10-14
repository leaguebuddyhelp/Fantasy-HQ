# Live mock class selection, AVP and position picker

Live mock startup now asks the coach to choose any installed Big Board class, including CUS05. The chosen class stays attached to that private mock. Weekly mock commands continue using the league season's assigned class.

The simulation market now runs 1,000 complete 60-pick drafts instead of 1,000 first rounds. AVP, earliest/latest picks, availability probabilities and pick-frequency distributions use both rounds. Each draft contains 60 unique prospects with the verified owners of all first- and second-round assets. A player receives an AVP only if actually selected in the sample; the system does not invent an average for an undrafted player. At least 60 distinct players therefore receive an AVP, with potentially more across the varied drafts.

Market snapshots are stored separately by league season and draft class. Generating or refreshing another class does not overwrite a live mock's market. Refresh jobs serialize per league to preserve the generation lock. The engine version changed so newly started mocks rebuild older first-round markets automatically. Existing rooms retain their saved snapshots and selections.

Make Pick now opens a private position chooser. PG, SG, SF, PF and C show remaining counts, including secondary-position eligibility. Selecting a position shows its top ten remaining prospects in the embed and up to 25 in the dropdown, ordered by board rank. Search remains available across all undrafted players. Coach ownership, pick clock, stale-pick checks and final confirmation remain in place.

Live mocks remain 30-pick first rounds; the 60-pick change applies to the simulation market used for AVP and the existing two-round weekly projections.

Regression coverage includes a real CUS05 market, 60,000 simulated selections, second-round AVPs, class isolation across default refresh and service restart, the class menu, position filtering and existing live-mock workflows. **All 682 tests passed** in `npm run check`, including syntax, TypeScript, browser and full-season simulation checks. Full-check results are recorded in `/tmp/lb-live-class-full-check.log` from an isolated source snapshot identified by `/tmp/lb-live-class-check-path`.

These changes are local and have not been pushed or deployed.
