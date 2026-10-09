# Railway deployment — October 9, 2026

Final production deployment: `a7b6c7fd-1541-4418-b252-2d1ad9497132` (SUCCESS), service Fantasy-HQ. Public `/health` returned `{"ok":true}`. Startup logs confirm a storage backup, website startup, 30/30 team emojis and Discord login as Fantasy HQ. Registered 24 guild slash commands, including `/promo`.

The first startup attempts were blocked by a recent writer lock from a stopped container. With explicit approval, temporary SSH access was registered to inspect the recovery instance. The original stale lock was archived only after its foreign host, unchanged contents and heartbeat age over two minutes were verified. No league records or Discord threads were deleted. The temporary key was removed and its agent stopped after verification.

Railway's subsequent volume handoff reproduced the startup timing problem. Startup now waits up to 180 seconds for the existing lease checks to permit acquisition, rather than exhausting process retries while the old heartbeat is still recent. The live-writer check remains enforced. Eight focused tests passed, including timeout without changing a live lock and acquisition after a stopped owner's heartbeat expires.

Remaining production warnings: Unknown Channel for Test Mode dashboard refresh, weekly Staff report and sportsbook announcement recovery. These channel references still need verification; successful deployment does not establish that these three workflows work in production.

Deployment used a staged upload excluding local credentials, local league data, reports and Git metadata. No Git merge or push was performed.
