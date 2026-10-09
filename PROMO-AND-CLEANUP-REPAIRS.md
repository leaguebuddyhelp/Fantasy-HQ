# Promo and cleanup follow-up — October 9, 2026

`/promo` now posts the supplied recruitment copy and invite in one public embed, with open teams grouped by conference and division. Each invocation refreshes Discord coach ownership before building the list. Inactive, ended and simulation assignments do not hide an available team. A full league shows a waiting-list message. Mentions are disabled.

Cleanup previews now warn about visible active Week threads that do not match the saved game links, and disable deletion when no linked threads are found. They never adopt or delete threads based on names alone. Confirmations persist in a private league file across process restarts, retain the five-minute expiry and actor/server/storage checks, and remain outside website settings responses.

A GET-only Discord inspection found 14 visible Week 1 threads whose thread and game IDs did not match this local dataset. This establishes a local linkage mismatch; Railway's current dataset was not inspected, so its precise cause remains unverified. No real threads were deleted or relinked.

Verification: 35 isolated tests passed across promo, available teams, command registration/dispatch parity, cleanup and game threads. Tests cover embed limits, refreshed vacancies, unlinked-thread warnings, disabled zero-thread deletion, confirmation persistence in a fresh process, authorization and history preservation. Changed entry points passed syntax checks and `git diff --check` passed.

Command registration and deployment have not been run. These changes will appear in Discord after an explicitly authorized deployment and command registration.
