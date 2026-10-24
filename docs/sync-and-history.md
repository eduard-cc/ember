# Sync, outbox and history data

Read before changing the sync feed or outbox, local persistence, recovery export/restore, Strong reimport, history editors, or per-session aggregates.

## Invariants

- IndexedDB/Dexie (`src/storage/`) owns durable local state. Legacy migration keeps the original bytes; invalid storage blocks writes. Report "saved" only after the transaction commits.
- One writer tab per installation holds the Web Lock `gym-log:installation:writer` (`src/storage/draft-lock.ts`). Active workouts stay on the installation that started them and never enter server sync. Finish saves completed history, queues its operation and removes the draft in one transaction.
- Outbox retries keep the operation's immutable identity. Revision conflicts and rejections stay visible and retained; never silently overwrite peer data.
- Sessions use HttpOnly cookies and a memory-only CSRF token (`X-CSRF-Token`). Production uses Tailscale identity auth (`GYM_LOG_AUTH_MODE=tailscale`, exact owner login in external config); password mode exists for local development and tests.
- Reviewed Strong replacement touches imported history only. Compare the complete current imported membership and content before treating an identical file as a no-op; retained source hashes are provenance, not proof of current identity.
- Recovery export is validated, versioned JSON with source evidence, owner/revision provenance and local drafts, without session secrets. Restore pauses edits and sync, requires confirmation, and rebuilds create-only operations rather than replaying acknowledgements.

## Extending the sync feed

Also follow the sync-protocol-evolution workflow for a new record kind.

- Deploy the compatible server bridge before the UI, so a one-command rollback keeps API support.
- Filter opt-in kinds before pagination for legacy clients (`server/src/sync/service.ts`), so a legacy cursor is always the last change it could see.
- Keep an independent opt-in cursor (see `DELETES_CURSOR` in `src/sync/engine.ts`). A one-time replay boolean is not enough: a rolled-back frontend can advance the shared cursor past hidden creates, edits or tombstones. Test upgrade, legacy cursor advancement and return to the new frontend.

## Retriggering sync

`src/sync/use-sync.ts` triggers an immediate sync only for newly eligible operation IDs, excluding entities blocked by retained issues. Do not retrigger merely because a sync finished with a non-empty outbox: conflicts and rejections intentionally stay queued and would loop the change feed. Verify conflict and rejection quiescence with periodic polling disabled, while keeping normal periodic and wake (`online`/`focus`) retries.

## Editing history

- Compare optimistic editor bases with `canonical()` (`src/storage/canonical.ts`), not `JSON.stringify`: schema-normalized reads and reimport's appended exclusion flags can reorder otherwise identical objects and falsely block edits or deletes. Test editing and deleting after a newer Strong import carries exclusions.

## Aggregating history

- `getHistory` (`src/domain/model.ts`) returns exercise-block entries, not unique workouts: a workout with repeated blocks of one exercise yields several entries.
- Aggregate per-session exercise volume across matching blocks by `workoutId`, without merging or deleting raw blocks or sets.

## Wiping server data

Also reset every client's local store and outbox, or local-first sync pushes the old records straight back. Verify on a real phone, not only in Playwright.
