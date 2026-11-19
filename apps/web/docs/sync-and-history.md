# Sync, outbox and history data

Read before changing the sync feed or outbox, local persistence, recovery export/restore, imported history, history editors, or per-session aggregates. Protocol rules (record kinds, extending the feed, retiring a stored field) are in `packages/contracts/README.md`; wiping server data in `apps/api/AGENTS.md`.

## Invariants

- IndexedDB/Dexie (`apps/web/src/storage/`) owns durable local state. Legacy migration keeps the original bytes; invalid storage blocks writes. Report "saved" only after the transaction commits.
- One writer tab per installation holds the Web Lock `ember:installation:writer` (`apps/web/src/storage/draft-lock.ts`). Active workouts stay on the installation that started them and never enter server sync. Finish saves completed history, queues its operation and removes the draft in one transaction.
- Outbox retries keep the operation's immutable identity. Revision conflicts and rejections stay visible and retained; never silently overwrite peer data.
- Sessions use HttpOnly cookies and a memory-only CSRF token (`X-CSRF-Token`). Production uses Tailscale identity auth (`EMBER_AUTH_MODE=tailscale`, exact owner login in external config); password mode exists for local development and tests.
- Ember is the source of truth and has no import flow. Imported history syncs with its own `putImportedWorkout` / `deleteImportedWorkout` kinds (never mixed with native `putWorkout`), lives under `imported:<id>` in `importSources` once synchronized (`current-dataset` before), and keeps each set's raw `original` cells and the original export bytes (`hash:<sha256>` sources, also in recovery archives). Keep all of these readable for existing installs and archives; the server's `resetDataset` (`apps/api/src/sync/reset.ts`) reseeds imported history for recovery.
- Recovery export is validated, versioned JSON with source evidence, owner/revision provenance and local drafts, without session secrets. Restore pauses edits and sync, requires confirmation, and rebuilds create-only operations rather than replaying acknowledgements.

## Saving and sync guarantees

- "Saved on this device" means the IndexedDB transaction committed. It does not protect against clearing browser storage, uninstalling the PWA or losing the device; server sync is not off-device backup either (see `ops/README.md`).
- A second same-origin tab is read-only until the writer closes and it is reloaded. Failed writes keep the draft and show a visible storage error rather than claiming success.
- Completed history, imported history, templates and body-weight entries sync automatically while the app is open and connected, with no manual Sync Now control; routine sync is silent, while auth blocks, failed saves and rejected changes surface. An expired session reconnects automatically. Pending changes survive reopening, and previously trusted installations keep logging offline. Android does not guarantee uploads while the PWA is closed.
- Valid legacy `ember:v1` localStorage data migrates transactionally, keeping the original bytes. Malformed or unsupported data blocks writes; an explicit reset preserves recovery evidence.
- Recovery export/restore lives in the storage layer and is not exposed in the UI. Exports are version 2 and always list body-weight entries (tombstones included); version 1 archives still restore. Diagnostic pending operations are labelled, not replayed as old acknowledgements, and a restore never authorizes overwriting newer server revisions.

## First download

- The writer tab asks for persistent storage (`navigator.storage.persist()`, only when not yet persisted). Best-effort IndexedDB can be evicted, after which the installation is fresh and downloads the whole feed again.
- `history-downloaded` in `syncState` is written with the feed page that has `hasMore: false`. Until then `useSync().historyDownload` shows the Downloading history (or Offline) pill and History ends with a still-downloading label instead of letting empty states read as "no workouts"; `history-download-started` marks an interrupted first download so it stays labelled after reopening. Installations that synced before the flag existed already hold the deletes cursor and count as complete. The label needs a connected owner (a fresh install that is offline on first open shows only the offline status), and a legacy install holding only `cursor` shows it once while it replays the feed.

## Retriggering sync

`apps/web/src/sync/use-sync.ts` triggers an immediate sync only for newly eligible operation IDs, excluding entities blocked by retained issues. Do not retrigger merely because a sync finished with a non-empty outbox: conflicts and rejections intentionally stay queued and would loop the change feed. Verify conflict and rejection quiescence with periodic polling disabled, while keeping normal periodic and wake (`online`/`focus`) retries.

## Editing history

- Compare optimistic editor bases with `canonical()` (`apps/web/src/storage/canonical.ts`), not `JSON.stringify`: schema-normalized reads can reorder otherwise identical objects and falsely block edits or deletes. Test editing and deleting imported as well as native workouts.

## Aggregating history

- `getHistory` (`apps/web/src/domain/model.ts`) returns exercise-block entries, not unique workouts: a workout with repeated blocks of one exercise yields several entries.
- Aggregate per-session exercise volume across matching blocks by `workoutId`, without merging or deleting raw blocks or sets.

## Testing sync and storage

- Lost acknowledgements: forward the request to the real API, wait for its response, then abort only the browser's delivery. Compare the retried operation's body and the feed revisions.
- Playwright `storageState` does not capture IndexedDB. Test reopening with a fresh page in the same context.
- Chromium rejects a Web Lock request that has both `ifAvailable` and `signal`, so `apps/web/src/storage/draft-lock.ts` checks the signal inside the callback and chains acquisitions, which keeps a StrictMode remount from seeing its own earlier lock as another writer.
- CDP `Storage.overrideQuotaForOrigin` is a probe, not proof. To test a full disk, throw `QuotaExceededError` at the native IndexedDB write inside a real transaction and name the test as an injection (`apps/web/tests/e2e/local-workflows.spec.ts`).
- Wait for a field to be enabled after hydration before focusing it: focusing a disabled field does nothing, silently.
