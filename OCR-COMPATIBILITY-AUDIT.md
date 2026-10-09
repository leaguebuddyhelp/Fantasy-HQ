# OCR compatibility audit — screenshots and phone photos

Pass 1, October 8, 2026. Commit `f1c40ed6835c6451b45bcc559fda5582be0eedb2`.

User requirement: **all applicable OCR scanners must accept ordinary phone pictures and direct screenshots.** No scanner was changed in this pass. Current coverage does not meet that requirement consistently.

## Scanner matrix

| Scanner / entry point | Direct screenshots | Phone JPEG/PNG | Native HEIC | Evidence / limitation |
| --- | --- | --- | --- | --- |
| Game box scores, coach and Staff sides | Real fixtures pass; PNG/JPEG/WebP intake | Real provider passes camera framing, EXIF orientation and modest tilt tests | Rejected by submission intake | Layout anchors and bounded deskew exist; arbitrary perspective/glare is not established |
| Regular-season FA contract offer | Three real 4K fixtures pass; PNG/JPEG/WebP intake | Accepted as files, but all three new framed/tilted/oriented probes lose required fields | Rejected by Discord upload gate | Fixed complete-screen crop and fallback text are insufficient for these photo variants |
| Retirement import | Existing import/correction tests; JPG/PNG intake | Normalized, oriented and passed to OCR | Supported; actual phone HEIC decode/OCR verified | Expected retirement-row accuracy on the full provided photo set not verified |
| Draft lottery import | Shared offseason evidence pipeline | Shared normalization and manual review | Supported by shared pipeline | Actual expected lottery rows from phone captures not verified in this pass |
| Official draft import | Shared offseason evidence pipeline and candidate matching | Shared normalization and manual review | Supported by shared pipeline | Actual expected drafted rows from phone captures not verified |
| Player/team options import | Shared offseason evidence pipeline, parser proposals and confirmation | Shared normalization and manual review | Supported by shared pipeline | Full phone corpus, structure/option completeness and perspective not verified |
| Offseason FA transaction report | Shared offseason evidence pipeline | Shared normalization and manual review | Supported by shared pipeline | Expected transaction rows from real phone captures not verified |
| Progression / final roster import | Shared offseason evidence pipeline and source review | Shared normalization and manual review | Supported by shared pipeline | All 30 teams' authoritative expected rows were not established |

The ratings/payroll roster scanner reads web pages; it is not a photo OCR scanner. Trade/upgrade proof attachment review is not necessarily OCR; accepting a proof image does not mean its contents are automatically extracted. Do not claim OCR coverage for non-OCR workflows.

## Verified experiments

Existing tests passed:

- Both real Association box-score screenshots.
- Four-kilopixel Cavaliers/Heat box-score uploads.
- Camera-style framing and EXIF orientation, including modest tilt.
- The three user-provided contract examples saved as 4K JPEG fixtures: Payne, Yabusele and Thomas.
- Original-byte preservation, duplicate evidence protection, validation and manual review behavior.

New temporary contract-photo probes used the Payne fixture. Expected values were **$3.90M**, **1+1**, **Flat**, **Team**. A 1600px screenshot derivative was placed inside a 1900×1300 JPEG frame, then tested with framing, four-degree tilt, and EXIF orientation. All variants retained the original supplied bytes.

| Probe | Salary | Years | Structure | Option | Result |
| --- | --- | --- | --- | --- | --- |
| Framed phone-style JPEG | Missing | 1+1 | Flat | Team | Incomplete |
| Framed JPEG tilted 4° | `1` | Missing | Missing | Team | Incorrect/incomplete |
| Framed JPEG with EXIF rotation | Missing | 1+1 | Flat | Missing | Incomplete |

These are synthetic camera-style variants of a real image, not a claim about the failure rate of all phones. They reliably demonstrate a current recognition gap. Manual correction remains available, and missing required fields prevent these examples from becoming valid unreviewed contracts.

The actual provided `IMG_1306.HEIC` was read locally: **4284×5712**, HEIF/HEIC format. The existing offseason worker decoded it to PNG and OCR produced **1093 text characters**. Original bytes were unchanged. This proves decode and OCR execution, **not** accurate row extraction or correct league matching. Expected rows and values must be compared against human-reviewed truth before certifying the scanner.

## Verified implementation differences

- `game-submissions.js` checks both attachment MIME and JPEG/PNG/WebP signatures. HEIC is not in its accepted type map.
- `discord-free-agency.js` accepts only PNG/JPEG/WebP under 20 MB. It preserves the original and lets users correct extracted contract fields.
- `recognizeContractText` orients the image but uses fixed offer-value crops only when a complete Sign Contract screen is close to 16:9. The framed photos fall back to whole-image text recognition.
- `offseason-image.js` supports JPEG, PNG and bounded HEIC, applies orientation and normalization, and queues HEIC worker decoding with limits/timeouts.
- `retirement-import-service.js` supplies normalized derivatives to OCR while preserving original evidence and hashing it before confirmation. Other offseason imports reuse this evidence path.
- Game OCR has table-anchor/framing and modest-deskew logic that contract/offseason text OCR does not uniformly share. Strong perspective, glare, blur and clipped rows must produce uncertainty/manual review rather than invented values.

## Pass 2 acceptance criteria

1. Consistent supported-format policy for ordinary JPEG/PNG screenshots and phone photos, including native HEIC where the app promises phone support. Preserve the original format/bytes and store any normalized derivative separately.
2. Decode orientation before coordinate work. Handle screen borders and modest camera angle through evidence-based layout detection rather than assuming the whole photo is the game screen.
3. Per-scanner expected-value fixtures for straight screenshots, framed phone captures, rotated metadata, modest tilt, and real HEIC. Include unreadable, clipped, oversized and disguised-format negatives.
4. Game scores/stat totals must reconcile; FA salary/years/structure/option must be exact or explicitly uncertain; offseason rows must match permanent IDs and reviewed values. Name ambiguity must never guess silently.
5. Verify both Staff and coach game uploads, regular-season FA offers, and each offseason import kind through the actual entry point, not just a shared decoder unit test.
6. Keep bounded downloads, byte/pixel limits, worker queue/timeouts, immutable evidence, duplicate protection, manual correction, revalidation and confirmed commits.
7. Run the supplied phone corpus locally with a human-reviewed expected-results manifest. Successful decoding or a nonempty OCR string is not a passing accuracy result.

**Status: LA-03 is a P1 launch blocker. Fixes require Pass 2 approval.**
