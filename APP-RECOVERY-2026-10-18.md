# App recovery — October 18, 2026

## Confirmed bottlenecks

The production inventory found a 35,435,634-byte `mock-draft/live.json` and roughly 186 MB of total mock state. The one-second mock tick parsed the live file twice per guild, including full rosters, input copies and finished draft recaps. That made retained history part of every active poll.

Server timing separated data building from encoding. One league-home request built its payload in 71.6 ms but spent 11,617.8 ms waiting for/completing asynchronous compression. A players request built in 50 ms but took 17.6 seconds end to end without compression. A compressed players request completed in 183 ms. These observations distinguish server work from transfer/queueing; they do not attribute every delay to one component.

The host reported a 24-core CPU quota, a 24 GB memory limit and zero CPU throttling in the measured interval. A hardware upgrade was not justified by that evidence.

## Repairs

- Polling now reads only mock status/control metadata, caches it against file identity and modification metadata, and refreshes immediately after atomic changes. It does not clone full roster inputs and recaps every second.
- Finished mocks at least one hour old move out of the hot file in bounded batches. Active/paused mocks and eligible pending recap deliveries stay live. Full archived records remain available through the same lookup. Copy-first archival preserves either the live record, the archived record or both if interrupted.
- JSON compression runs synchronously inside its own computation worker, outside the shared I/O pool. If compression fails, the HTTP layer sends the original JSON instead of losing the response.
- Public Discord DNS queries use coalesced, TTL-bounded asynchronous resolution. The original system lookup remains the fallback for failures, private names, IP literals and explicit IPv6 requests. Existing Discord SDK serialization, authorization and rate-limit handling remain in place.
- Startup handoff no longer produces a misleading runtime-stall warning; runtime stall monitoring starts after the storage lease and startup backup finish.
- Commissioner-only maintenance can preview and clean old unreferenced draft caches, expired sign-in records, stale temporary files and the retired player-upgrade state. Referenced snapshots are protected, including references in archived mocks. Cleanup requires a successful backup. Temporary and retired-feature files are archived explicitly rather than discarded.

## Data boundaries

Rosters, contracts, ownership, trades, schedule, game records, OCR originals, roster report photos, referenced draft snapshots and existing backups are preserved. No completed results or current roster memberships are reset. The storage writer lease remains enforced. Cleanup plans expire and recheck file content and references before removal.

## Technical sources

Node documents the difference between system lookups and asynchronous DNS resolution in its [DNS implementation considerations](https://github.com/nodejs/node/blob/main/doc/api/dns.md#implementation-considerations). Discord exposes a supported [REST agent configuration](https://discord.js.org/docs/packages/rest/2.6.0/rest%3Aclass). Slow name resolution competing for shared I/O is a plausible contributor; the measured compression delay is the directly observed failure.

## Verification

Targeted tests cover archive readability, copy-first safety, pending recap preservation, polling cache invalidation, parallel compression, worker failure, DNS coalescing/TTL/fallback behavior, backup refusal, changed-file/reference protection, commissioner authorization and HTTP timing privacy. Full-suite and production rollout results are recorded after verification below.
