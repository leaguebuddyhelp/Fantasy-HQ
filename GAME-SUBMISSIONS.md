> Current workflow: hosted Tesseract processing requires no API key. Each coach submits one side; validated two-coach results can finalize. See [Tesseract setup](TESSERACT-SETUP.md). Earlier provider/flow details below describe the previous stage.

# Game screenshot submissions

The upload layer collects two original images. A separate extraction layer now processes completed submissions into pending-review data; see [Box-score extraction](BOX-SCORE-EXTRACTION.md). It does not confirm results, finalize games, or update standings.

## Try it in Discord

1. Register commands with `npm run deploy:commands`, then restart with `npm start`.
2. Enable Message Content Intent for the bot in the Developer Portal. The client requests GuildMessages and MessageContent to receive attachments.
3. Start the league's regular season through the existing website action.
4. Use an existing **private thread** and add the bot and both owners. The bot needs access to view the thread, read messages, and send messages in threads.
5. As league staff, run `/game setup week:1 team:MIL` inside the thread, choosing the actual week and either team's exact name or abbreviation. This posts the main game message and does not create a thread or regenerate the schedule.
6. As either team's owner, click **Submit Game**. Instructions show 0/2.
7. Upload a JPG, PNG, or WebP image (up to 25 MB). Expect 1/2.
8. Upload the other box score. Expect **GAME SUBMISSION RECEIVED — 2 / 2 Box Scores Uploaded**. Both images in one message also work.
9. Cancel an incomplete attempt and start again to verify history is retained. Submit Game resumes an incomplete attempt; after receipt or cancellation it opens a new attempt.

This checkout had no game records, thread bindings, or main game-message builder. `/game setup` is the minimal staff-only bridge. Games are identified from the saved schedule by season, week, and matchup, with a stable gameId assigned once.

## Permanent records

Records live in `FANTASYHQ_DATA_ROOT/game-history/<gameId>/record.json` (default `data/fantasyhq/game-history`). Each document contains the Game, its submission history, and media metadata. Attempts move from COLLECTING to RECEIVED or CANCELLED.

Original files live beside the record under `originals/<mediaId>.<extension>`. Bytes are saved without resizing, recompression, or editing. Metadata retains original Discord attachment ID, URL, filename, MIME type, size, message/thread IDs, uploader, creation time, and a SHA-256 checksum.

Future consumers call `load(gameId)`, select a submission and media by submissionId, then use `readOriginal(gameId, mediaId)`. No Discord download is needed again. Image order is upload order; team identity is not inferred.

Game history is outside league folders and independent of Discord thread lifecycle. There is no thread-delete cleanup handler or media-delete operation. Keep this directory on persistent disk and back it up; local storage is not a cloud backup. Run one bot process per data directory, matching the app's JSON storage model.

Both owners can make separate attempts; their images are never mixed. Each upload checks ownership, private thread/guild binding, lock/final status, image type/headers, size, and remaining slots. Repeated attachment IDs are counted once per attempt. Failed downloads are not counted; earlier successful uploads remain stored.

The game remains SCHEDULED when a submission reaches RECEIVED. Completed submissions now trigger the configured vision extraction service; extraction does not finalize the game.

Automated tests cover the button/message path, batches, unauthorized users, wrong threads, invalid images, cancellation/history, restart recovery, original-byte preservation, retrieval without Discord, concurrent uploads, failed-download retries, and unchanged schedules. Live Discord rendering and permissions require a manual check.
