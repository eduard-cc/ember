# @ember/contracts

The documents the web app and the API exchange and store: workouts with their sets, body-weight measurements, sync operations and the web app's stored state, plus the retired keys older documents may still carry and the rule for which built web files the server sends. Both apps import them, so a renamed or retyped field fails type-checking or tests in both in the same PR.

## Rules

- One definition per document. The API adds its size bounds (identifier and name lengths, exercise and set counts, revisions) on top of these schemas in `apps/api/src/sync/schema.ts`; they never move here, because the web app parses documents already stored on a device and must never newly reject them.
- A field leaving a document is added to `src/retired-keys.ts`: both apps then accept it and drop it on parse ("Retiring a stored field" below).
- `zod` is the only dependency, as a peer: each app resolves it from its own `node_modules`, so each build holds one zod. The package has no `node_modules` and no lockfile of its own.
- No Node, browser, Nest or React APIs; the code must compile under both apps' compiler settings. Node-only helpers such as the security headers stay in the API.
- One file per area, re-exported from `src/index.ts`. Relative imports end in `.js` (the package is ESM).
- `src/static-files.ts` imports nothing, so the web build's Vite config can load it by path.

## How each consumer loads it

- Web: `@ember/contracts` is an alias to `src/` (`apps/web/contracts.config.ts`, used by `apps/web/vite.config.ts` and `apps/web/vitest.config.ts`, and the `paths` in `apps/web/tsconfig.json`). Vite's `dedupe` and the `zod` path resolve the package's zod from `apps/web/node_modules`. Nothing to build.
- API: `npm --prefix apps/api run contracts:build` compiles `src/` with the API's TypeScript into `apps/api/contracts/` (git-ignored; CommonJS and declarations, `apps/api/tsconfig.contracts.json`). The API imports it as `#contracts` through the `imports` field of `apps/api/package.json`. Because the compiled files sit inside `apps/api`, plain Node resolution finds the API's own zod: one zod instance, and no runtime flags. A linked `file:` dependency would resolve zod from this directory instead, where there is none. That build maps `zod` to `apps/api/node_modules/zod` explicitly, so a missing zod fails it loudly. `build`, `typecheck`, `lint`, `lint:check`, `dev`, `migration` and `start:trial` run it first; after editing the package, rerun it (or restart `dev`) so a running API and the editor pick up the change.
- Docker: the image's build stage copies `packages/` next to `apps/`, and the runtime stage ships `apps/api/contracts/` as `/app/server/contracts`.

Formatting follows the repository's root `.prettierrc` and runs with the web app's `format` and `format:check`.

## API contract

All paths below are prefixed `/api/v1`. Every response uses `Cache-Control: no-store`.
`GET /health` returns `{status:"ready"}` after a database readiness query.
`POST /session` accepts `{password}` in default password mode or `{}` in Tailscale mode; successful login returns
`{ownerId,csrfToken}` plus `ember_session` HttpOnly, SameSite=Strict cookie,
scoped to `/api/v1`, Secure when configured. Only the token hash is persisted in PostgreSQL.
`GET /session` returns current owner and CSRF token, or 401 for missing/revoked/expired session.
`DELETE /session` revokes that session and clears the cookie, returning `{loggedOut:true}`.
Every mutation requires the exact configured Origin; authenticated mutations also require
`X-CSRF-Token` matching the PostgreSQL session. Login itself uses exact-origin protection.
Password-mode login is limited to five attempts per minute, globally per API process, before Argon2 work.
This constant-space local limiter is not a distributed or restart-resistant deployment limiter.

`POST /sync/operations` accepts `{version:1,operations:[...]}` (1–50, at most 10 MiB).
Operation fields: UUID `operationId`, nonempty string `entityId`,
`kind` (`putBodyWeight`, `putWorkout`, `deleteWorkout`, `putTemplate`, `deleteTemplate`,
`putImportedWorkout`, `deleteImportedWorkout`), nullable `expectedRevision`,
and `payload` (Workout, BodyWeight or null). A BodyWeight is `{id,date,kg,deleted}`: a calendar-valid
local wall time, kg above 0 and at most 500 with at most two decimals, and a tombstone flag. It is
stored in the same generic `records`/`changes` tables; each kind may only revise records of its own
kind, so measurements and workouts can never overwrite each other. Measurement updates and
tombstones require the current revision, like templates; a deleted measurement is a revisioned
tombstone (`deleted: true`) that Undo revives. Source entity/set IDs are not forced to UUIDs.
All Workout fields including the optional completion flag and string-valued `original` evidence
are preserved (the retired `excluded`/`suspicious` set flags are accepted from older clients and dropped), with no timestamp conversion, name merging, set deduplication or analytics.
Unknown fields, nonfinite values and ID mismatches are rejected. Defensive bounds:
IDs 512 characters; names 1000; up to 1000 exercises and 5000 sets per exercise.
Dates are calendar-valid timezone-free `YYYY-MM-DDTHH:mm:ss` wall timestamps or
legacy empty strings; timezone suffixes, fractions and impossible dates are rejected.
Workout creates require at least one set and reject any explicitly uncompleted set;
absent completion flags are supported for historical imports. This does not allow clients
to sync active drafts: they must keep drafts entirely outside the operations contract.

Responses use the envelope **`{results:[ack,...]}`**.
Each ack has `{operationId,status,entityId,revision,changeSeq,errorCode?}`;
null revision/sequence means no accepted write. Malformed operation IDs are echoed only
for client diagnosis; schema rejections are not entered in the validated operation ledger.
Top-level invalid batches return 400. Each valid operation has its own transaction,
processed in input order; a database failure returns 500, so retry the immutable batch:
earlier committed operations replay their original acknowledgement.

A recursively key-sorted canonical validated payload is SHA-256 hashed in the ledger.
Same operation ID/same content returns its original accepted/conflict/semantic rejection;
different validated content returns `OPERATION_ID_REUSED` conflict without writes.
`expectedRevision:null` is create-only. Existing IDs cannot be silently recreated.
Template updates/deletes require the current revision. Deletion keeps a revisioned
tombstone that cannot be resurrected. The owner may edit finished
(`putWorkout`) and imported (`putImportedWorkout`) workouts at the current revision; an edit
still needs at least one set and no uncompleted set. `deleteWorkout` tombstones a native
workout at its current revision and is final. Every earlier revision stays in `changes`.
Each kind revises only its own records: native and imported history, templates and
measurements can never overwrite one another.
Imported history uses its own operation kinds; the app has no import flow, so they carry only
history already imported. Deletion tombstones only imported records at the current revision,
and a put at an imported tombstone's exact revision revives it.

`GET /sync/changes?after=0&limit=100` accepts safe integer cursor and limit 1–100.
Returns `{changes,nextCursor,hasMore}`; each change has
`{entityId,kind,revision,changeSeq,payload}`. Deleted-template payloads are null.
Every client receives every record kind, so `nextCursor` is the last returned change (or
`after` when the page is empty).

Records, feed writes, sequence allocation and ledger writes commit atomically.
An owner-scoped transaction advisory lock is acquired **before** allocating sequence
values; the transactional sequence row prevents uncommitted writes from being skipped.
Concurrent stale edits, delayed commits, rollback/retry and pagination use real PostgreSQL tests.

## Extending the sync feed

A new record kind ships compatibly:

- Deploy the compatible server bridge before the UI, so a one-command rollback keeps API support.
- Filter opt-in kinds for legacy clients in the feed query, before pagination (`apps/api/src/sync/service.ts`), so a legacy cursor is always the last change it could see.
- Keep an independent opt-in cursor in the web app's `syncState`, read in place of `cursor` and written beside it in the same transaction. A one-time replay boolean is not enough: a rolled-back frontend can advance the shared cursor past hidden creates, edits or tombstones. Test upgrade, legacy cursor advancement and return to the new frontend.
- Before writing it, read the deployed client's validator (`git show <deployed-sha>:apps/web/src/sync/engine.ts`); `ops/livecheck.sh` prints the deployed release. The bridge and the UI are separate PRs: merge and deploy the bridge before merging the UI.
- A parallel feature with its own opt-in kind conflicts in the kind enum, the headers, the apply branch and the cursor writes. Resolve to the union and keep both headers; one feature's header never exposes another feature's kind.
- On every legacy page, at limits 1, 2 and 100, assert that `nextCursor` is the last `changeSeq` (or `after` when the page is empty), that a page is never empty while `hasMore`, and that every kind is in the old strict enum. Checking only that the hidden kind is absent also passes when filtering runs after pagination. Cover the hidden record being the newest change.
- The kind-compatibility table is a `Record<OperationKind, readonly OperationKind[]>` (`allowedKinds` in `apps/api/src/sync/service.ts`), so a missing entry fails to compile instead of failing mid-batch.
- Unit-test export with a pending tombstone in the outbox: strict backup validators reject payloads they didn't expect. Prove the whole path with one two-device integration test against a real database; mocked-feed unit tests miss header and cursor wiring.

## Retiring a stored field

- Stored, synced and backed-up documents outlive the code that wrote them. When a field leaves the contracts, accept and drop it on parse (add it to the retired keys in `packages/contracts/src/retired-keys.ts`, which both apps' schemas apply), strip it from IndexedDB in a new Dexie version's `upgrade` (`apps/web/src/storage/db.ts`, `apps/web/src/storage/retired-fields.ts`) and from `records`/`changes` in a server migration, without bumping revisions. Never rewrite original import bytes (`raw`) or restore-evidence archives. The retired set flags `excluded`/`suspicious` and the `suspiciousRows` warning follow this pattern.
