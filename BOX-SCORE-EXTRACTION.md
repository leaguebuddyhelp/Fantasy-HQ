> Current workflow: hosted Tesseract processing requires no API key. Each coach submits one side; validated two-coach results can finalize. See [Tesseract setup](TESSERACT-SETUP.md). Earlier provider/flow details below describe the previous stage.

# Box-score extraction

## Configuration and manual test

Set these in the server's .env (never commit the real API key):

```env
OPENAI_API_KEY=your-api-key
BOX_SCORE_MODEL=gpt-4.1
```

Restart the bot. No slash-command redeployment is needed for this step. A completed two-image submission now triggers extraction automatically. Original images are read from permanent storage and sent together to the configured vision provider. There is no OCR fallback.

For existing uploads, run the existing `/game setup` inside their linked thread to refresh the main game message, then click **Process stored box scores**. **Retry extraction** on a processing/result message retries that specific attempt's submission. Both team owners and league staff can retry in the correct private thread; finalized or locked games are rejected.

A model error, missing API key, refusal, or incomplete response leaves the originals intact and sets EXTRACTION_FAILED. Configure/fix the provider and retry without reuploading. Retry preserves every earlier extraction attempt. Interrupted PROCESSING attempts can be retried after a restart. Concurrent requests within the bot process share the same extraction job. Continue to run one process per data directory.

The bot posts a compact summary and a **Review Game** link. WEBSITE_URL must be reachable by the people opening it. The foundation page uses the existing WEBSITE_ADMIN_KEY; Discord-owner website login is not implemented. No correction or confirmation controls exist yet.

## Architecture

- `box-score/provider.js`: replaceable `name`, `model`, `extract(images)`, `parse(response)` interface. Default OpenAI Responses API implementation uses image inputs and strict structured output. Model is configurable. Entire response body (including provider errors) is retained before parsing.
- `box-score/service.js`: loads two stored originals, creates a durable extraction attempt, calls the provider, normalizes, validates, and records status. No official stats service is called.
- `box-score/normalize.js`: deterministic numeric/split normalization, team identification, roster-scoped player matching, confidence checks, and reconciliation.
- `box-score/discord-summary.js`: concise result/failure summaries, retry and website handoff.
- `box-score/review-route.js`: read-only, authenticated JSON/original-media routes and a minimal review landing page.

Official references used: [image inputs](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1).

## Persistent data

Game history's `record.json` now includes an `extractions` array. Each BoxScoreExtraction contains extractionId, submissionId, gameId, source mediaIds, provider/model, timestamps, original raw response, normalized data, validation booleans, review issues, and the roster snapshot used for matching. Failed attempts retain raw responses when one was received and a failure reason. Originals and previous attempts are never replaced.

Submission states: RECEIVED (existing uploaded state) → PROCESSING → READY_FOR_REVIEW or REVIEW_REQUIRED; failures become EXTRACTION_FAILED. Readiness means ready for human review, never approved or official.

Normalized data keeps one reading per screenshot with its source mediaId. Each includes both scoreboard teams, final scores, ordered Q1–Q4/OT1/OT2/etc. periods, the table's team, played/DNP player rows, and a separate total row. Stats include MIN, PTS, REB, AST, STL, BLK, TO, OR, FLS, FGM/FGA, 3PM/3PA, FTM/FTA and original displayed strings. DNP rows have null stats and do not count as appearances. No official PlayerGameStats records are written.

## Validation and uncertainty

Checks cover both scheduled teams, exactly two distinct image readings and team tables, independent scoreboard agreement, period agreement/sums including OT, player points versus total/scoreboard, additive player stats versus team totals, made/attempted consistency, and points implied by shooting splits. Values are never repaired. Rounded minutes or team-only statistical differences may produce review issues; the displayed data stays intact.

Team aliases are limited to full names, abbreviations, nicknames and cities derived from known teams; ambiguous aliases remain unresolved. Player candidates come only from active roster memberships for that game's team and season. Exact names or unique initial/surname matches can receive a playerId when row confidence is HIGH. Multiple plausible players retain candidates and null playerId; unmatched custom/traded players need review. No fuzzy best-guess selection is used.

HIGH/MEDIUM/LOW confidence and provider-reported uncertain field paths are retained. Missing confidence, MEDIUM/LOW confidence, absent values, and uncertain fields all require review. These are model-reported signals, not calibrated probabilities. Ambiguous names, cropped/blurred values and hidden OT periods remain unreliable until reviewed.

## Review handoff

- Page: `/games/:gameId/submissions/:submissionId/review`
- Data: `GET /api/games/:gameId/submissions/:submissionId/review`
- Original: `GET /api/games/:gameId/submissions/:submissionId/media/:mediaId`

API requests require the `x-leaguebuddy-admin-key` header. The page is a read-only status/issues foundation. Data includes all attempts; each submission points to its latestExtractionId. Original-media access never requests Discord again. No write/finalize/correct route was added.

## Verification and limits

The manually transcribed IMG_1155/IMG_1156 fixture contains Milwaukee 120, Cleveland 116, all visible stats, 20 players with stats and eight DNP rows. Its totals reconcile. The fixture is explicitly not a captured model response.

Automated coverage includes normalization, splits, DNPs, OT, names with apostrophes, ambiguous players, missing/low-confidence values, wrong teams, duplicate source images, conflicting scores/quarters, totals mismatches, provider errors/refusals/incomplete output, raw retention, retries using stored originals, concurrency, untouched game/schedule data, protected review routes and Discord retry authorization.

No OPENAI_API_KEY was configured during implementation. Live model accuracy and live Discord rendering remain unverified; model/API behavior was tested with mocked responses. No paid extraction was run. Standings, season averages, official stats, opponent confirmation and full review/correction remain outside this step.
