# Sync data on the server

## Wiping server data

Also reset every client's local store and outbox, or local-first sync pushes the old records straight back. Verify on a real phone, not only in Playwright.

## Testing against PostgreSQL

- TypeORM's raw `query()` returns `[rows, count]` for an `UPDATE ... RETURNING`. Wrap it as `WITH updated AS (UPDATE ... RETURNING ...) SELECT ...` to get plain rows.
- Test lock contention with a trigger that delays the first write, and poll `pg_stat_activity` for its `PgSleep` wait before sending the second request, never a fixed sleep (`test/sync.e2e.test.ts`).
- Supertest's implicit `listen(0)` binds every interface; `test/helpers.ts` binds the app to 127.0.0.1 explicitly.
