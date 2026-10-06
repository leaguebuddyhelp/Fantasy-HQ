# Game review and OCR audit

The Wolves–Rockets review returned 687,985 bytes across six revisions, including 426,564 bytes of raw OCR. The server returned it in 57 ms inside Railway, so the main avoidable delays were transferring and rendering unnecessary history, waiting for images before creating controls, and downloading originals again after saves.

## Changes

- The initial protected API returns revision summaries plus the latest editable extraction. Raw OCR and older tables stay in storage and are fetched only when a history revision is opened.
- The editor renders while both original images load independently. Image URLs are reused across saves and are cleared when the access key changes.
- Quarter-score warnings now jump to the actual quarter/final-score input. A reviewed player row can confirm its uncertainty checks together. Mathematical failures still require corrections and revalidation.
- Numeric OCR stops extra passes after two readings agree at 96% confidence. Invalid shooting-split text cannot outrank a properly formatted reading merely because its confidence is higher. Conflicting readings remain visible to validation.
- Roster matching supports known nicknames, supplied player aliases, diacritics, abbreviated names, and damaged-surname suggestions. Examples include N. Hyland / Bones Hyland and A. Sengiin / Alperen Şengün. Surname-only and ambiguous matches require selection.
- Commissioner-approved reviews persist observed-name aliases in each league's ocr-learning.json. Saved but unapproved edits teach nothing. Repeated processing of one game does not add evidence; conflicting examples disable automatic alias assignment. Learned identities must still exist on the appropriate roster. Startup imports previously approved commissioner reviews.

## Verification

A browser test delays original images until after the editor is usable, saves a correction without downloading them again, and confirms history is fetched only on expansion. API tests check compact responses, authorization, preserved raw history, and learning only after approval. OCR regressions cover the original screenshots, Wolves–Rockets submissions, and framed, rotated and tilted photos.

Initial offline OCR regression timing improved from 100.6 seconds to 74.8 seconds. These are local measurements; Railway CPU load, photo quality, and queued jobs affect real processing time. Repeated recognition agreement is an optimization, not permission to bypass scoreboard, roster or total validation.

## Live deployment verification

The same Wolves–Rockets review now returns 57,568 bytes instead of 687,985 bytes: a 91.6% reduction. Its six revisions remain accessible through protected on-demand history, including the original raw evidence. Website health and Discord login passed. Startup recovered 56 observed-name aliases from two previously approved commissioner reviews. Final syntax, TypeScript and full suite checks passed: 332 tests.
