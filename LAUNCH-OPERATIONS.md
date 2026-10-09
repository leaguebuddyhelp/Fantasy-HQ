# Launch verification and preservation

Repairs are on `repair/launch-readiness`. No merge, deployment, live Discord writes, league reset or automatic roster cuts were performed. Initial audit reports remain historical Pass 1 evidence.

## Data preflight

Run `node scripts/inspect-launch-readiness.js /path/to/data/fantasyhq <league-id>` against a consistent, healthy snapshot. It lists roster sizes, missing/duplicate IDs, ownership role configuration and legacy canonical Test Mode without correcting them. The website commissioner panel has the same launch check. It rejects pending storage journals rather than performing recovery as part of an offline preflight.

Before production launch, confirm the deployed volume is the intended league. The audited local candidate has 28 teams above 15 players and `testMode:true` without an isolated simulation ID. Staff must supply authoritative roster decisions; preserve ended memberships, IDs, contracts and historical evidence. No players should be deleted to make validation pass. Current Discord role membership must be checked in the connected guild; local role-ID mappings alone cannot verify it.

## One writer and startup

Run one app process and one Railway replica against the league volume. Do not run `start:web` beside the bot against the same storage. The writer lease now records Linux boot/process-start identity, distinguishes stale reused PIDs, keeps cross-host heartbeat protection and rejects another writer in the same process. Token fencing still blocks writes after lease loss. Do not manually delete a fresh lock or recovery directory. Diagnose its holder and heartbeat first; a malformed or interrupted recovery requires deliberate operator investigation.

After a separately approved deployment, verify startup logs show an acquired writer, connected Discord client and listening website; `/health` succeeds; slash commands acknowledge once; and a controlled restart preserves data. Current Railway availability cannot be proved by local tests, and the failed production deployment was not replaced during this audit.

## Backups and restore drill

The existing `npm run league:backup -- /path/to/data/fantasyhq` acquires a writer lease and therefore is an offline command. Stop the app first; do not bypass the lease. The connected website backup action is the online mechanism. Record the returned backup directory and manifest. Copy the completed backup directory and manifest to independent storage outside the Railway volume. Same-volume backups do not protect against volume loss. Keep at least one pre-launch snapshot and snapshots before destructive or roster decisions; decide retention explicitly before deleting any.

Use `npm run league:restore -- BACKUP_DIRECTORY NEW_NONEXISTENT_DIRECTORY` for an isolated restore drill. It verifies every manifest checksum and refuses overwrite. Inspect restored league IDs, roster memberships, game originals, contracts, trade/FA/waiver history, Sportsbook ledger, archives, awards and simulation checkpoints. Never point a restore drill at production. Existing tests verify snapshot preservation, tamper rejection and restoration into a fresh target; independent production backup recovery is still an operator verification gate.

## Practice and interfaces

The commissioner website panel previews only the isolated simulation selected in Discord. Restoration and mutations stay in Discord. Preview refuses an in-progress restore and mismatched league/identity. Live pages continue to show canonical published standings and statistics.

Sportsbook markets, wagers, wallets, history and Staff corrections stay in Discord. Website Sportsbook and coach-login endpoints return 410. See [Sportsbook controls](SPORTSBOOK-DISCORD.md).

The bot currently has Administrator in the audited guild. Before removing it, test a minimum-permission role in a separate guild: channel/role management, view/send/embed/attach/read-history, pin management, private-thread creation and membership, external emoji access, and any configured role icons. Do not strip permissions from the live bot during a launch audit.

## Remaining production acceptance

Verify real two-coach consent, revoked roles, Staff/commissioner separation, live game uploads, phone OCR review, week publication, Discord singleton recovery, private draft pick controls and final recap delivery in a separate connected test guild. Then approve deployment separately. Never report READY from local mocks alone when the running service or production league data still fails acceptance.
