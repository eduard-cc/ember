import {z} from 'zod';

import {WorkoutSchema} from '../../shared/contracts';
import type {WorkoutRepository} from '../storage/repository';

const changeSchema = z.strictObject({
  entityId: z.string().min(1),
  kind: z.enum([
    'putWorkout',
    'putTemplate',
    'deleteTemplate',
    'putImportedWorkout',
    'deleteImportedWorkout',
  ]),
  revision: z.number().int().positive(),
  changeSeq: z.number().int().positive(),
  payload: WorkoutSchema.nullable(),
});
export interface Session {
  ownerId: string;
  csrfToken: string;
}
export class SessionExpired extends Error {}
const ackSchema = z.strictObject({
  operationId: z.uuid(),
  entityId: z.string().min(1),
  status: z.enum(['accepted', 'conflict', 'rejected']),
  revision: z.number().int().positive().nullable(),
  changeSeq: z.number().int().positive().nullable(),
  errorCode: z.string().optional(),
});
export class SyncEngine {
  constructor(
    readonly repository: WorkoutRepository,
    readonly request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  async sync(session: Session): Promise<void> {
    const db = this.repository.db;
    const owner = (await db.meta.get('ownerId'))?.value;
    if (owner && owner !== session.ownerId)
      throw new Error('Owner mismatch; local records were not changed');
    if ((await db.meta.get('demo-installation'))?.value === true)
      throw new Error('Demo data cannot be synchronized');
    for (;;) {
      const order = (await db.syncState.get('queue-order'))?.value as string[] | undefined;
      const operations = await db.outbox.toArray();
      operations.sort(
        (a, b) => (order?.indexOf(a.operationId) ?? -1) - (order?.indexOf(b.operationId) ?? -1),
      );
      const issues = (await db.syncState.toArray())
        .filter((r) => r.key.startsWith('issue:'))
        .map((r) => r.value as {entityId: string});
      const seen = new Set(issues.map((i) => i.entityId));
      const batch = operations
        .filter((o) => {
          if (seen.has(o.entityId)) return false;
          seen.add(o.entityId);
          return true;
        })
        .slice(0, 50);
      if (!batch.length) break;
      let body = JSON.stringify({version: 1, operations: batch});
      while (batch.length > 1 && new TextEncoder().encode(body).byteLength > 9 * 1024 * 1024) {
        batch.pop();
        body = JSON.stringify({version: 1, operations: batch});
      }
      if (new TextEncoder().encode(body).byteLength > 9 * 1024 * 1024) {
        const o = batch[0];
        await db.syncState.put({
          key: 'issue:' + o.operationId,
          value: {
            operationId: o.operationId,
            entityId: o.entityId,
            status: 'rejected',
            revision: null,
            changeSeq: null,
            errorCode: 'DOCUMENT_TOO_LARGE',
          },
        });
        continue;
      }
      const response = await this.request('/api/v1/sync/operations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken},
        body,
      });
      if (response.status === 401) throw new SessionExpired('Sign in to resume sync');
      if (!response.ok) throw new Error('Server unavailable; changes remain pending');
      const {results} = z.strictObject({results: z.array(ackSchema)}).parse(await response.json());
      if (
        results.length !== batch.length ||
        results.some(
          (ack, i) =>
            ack.operationId !== batch[i].operationId ||
            ack.entityId !== batch[i].entityId ||
            (ack.status === 'accepted' &&
              (ack.revision !== (batch[i].expectedRevision ?? 0) + 1 || ack.changeSeq === null)),
        )
      )
        throw new Error('Invalid acknowledgement; changes remain pending');
      await db.transaction('rw', [db.outbox, db.syncState], async () => {
        for (const ack of results) {
          if (ack.status === 'accepted') {
            await db.outbox.delete(ack.operationId);
            await db.syncState.put({key: 'revision:' + ack.entityId, value: ack.revision});
          } else await db.syncState.put({key: 'issue:' + ack.operationId, value: ack});
        }
      });
    }
    let cursor = Number((await db.syncState.get('cursor'))?.value ?? 0);
    for (;;) {
      const response = await this.request('/api/v1/sync/changes?after=' + cursor + '&limit=100', {
        credentials: 'same-origin',
      });
      if (response.status === 401) throw new SessionExpired('Sign in to resume sync');
      if (!response.ok) throw new Error('Could not read server changes');
      const page = z
        .strictObject({
          changes: z.array(changeSchema).max(100),
          nextCursor: z.number().int().nonnegative(),
          hasMore: z.boolean(),
        })
        .parse(await response.json());
      let previous = cursor;
      for (const c of page.changes) {
        if (
          c.changeSeq <= previous ||
          (c.kind === 'deleteTemplate' || c.kind === 'deleteImportedWorkout'
            ? c.payload !== null
            : c.payload?.id !== c.entityId)
        )
          throw new Error('Invalid change page');
        previous = c.changeSeq;
      }
      if (page.nextCursor !== previous || (page.hasMore && !page.changes.length))
        throw new Error('Invalid cursor');
      await db.transaction(
        'rw',
        [db.syncState, db.workouts, db.templates, db.outbox, db.meta, db.importSources],
        async () => {
          for (const c of page.changes) {
            const pending = (await db.outbox.toArray()).some((o) => o.entityId === c.entityId);
            const old = Number((await db.syncState.get('revision:' + c.entityId))?.value ?? 0);
            if (c.revision >= old) {
              await db.syncState.put({key: 'revision:' + c.entityId, value: c.revision});
              if (!pending) {
                if (c.kind === 'putWorkout') await db.workouts.put(c.payload!);
                else if (c.kind === 'putTemplate') {
                  await db.templates.put(c.payload!);
                  await db.meta.put({key: 'templates-null', value: false});
                } else if (c.kind === 'deleteTemplate') await db.templates.delete(c.entityId);
                else {
                  await db.meta.put({key: 'imported-sync-active', value: true});
                  if (c.kind === 'putImportedWorkout')
                    await db.importSources.put({key: 'imported:' + c.entityId, value: c.payload!});
                  else await db.importSources.delete('imported:' + c.entityId);
                }
              }
            }
          }
          await db.syncState.put({key: 'cursor', value: page.nextCursor});
        },
      );
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
  }
}
