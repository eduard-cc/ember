import {z} from 'zod';

import {
  type BodyWeight,
  BodyWeightSchema,
  WorkoutSchema,
  isDeleteKind,
} from '../../shared/contracts';
import type {Workout} from '../domain/types';
import type {WorkoutRepository} from '../storage/repository';

/**
 * Opt-in feed kinds (body weight, workout deletions) share one cursor of their own: an older
 * app version's cursor may already be past records it never saw, so the first sync of an app
 * that understands every kind replays the feed from zero.
 */
export const DELETES_CURSOR = 'workout-deletes-cursor';
// Unknown kinds fail the whole page before the cursor moves, so a newer server's
// records are never skipped or written into the wrong table.
const changeSchema = z
  .strictObject({
    entityId: z.string().min(1),
    kind: z.enum([
      'putBodyWeight',
      'putWorkout',
      'deleteWorkout',
      'putTemplate',
      'deleteTemplate',
      'putImportedWorkout',
      'deleteImportedWorkout',
    ]),
    revision: z.number().int().positive(),
    changeSeq: z.number().int().positive(),
    payload: z.union([WorkoutSchema, BodyWeightSchema]).nullable(),
  })
  .refine(
    (c) =>
      c.payload === null ||
      (c.kind === 'putBodyWeight' ? BodyWeightSchema : WorkoutSchema).safeParse(c.payload).success,
    'Payload does not match change kind',
  );
export interface Session {
  ownerId: string;
  csrfToken: string;
  /** Server dataset epoch; absent on servers that predate resets. */
  epoch?: string;
}
export class SessionExpired extends Error {}
/** The server dataset was reset; this installation must drop its synced copies first. */
export class DatasetReset extends Error {
  constructor(readonly epoch: string) {
    super('Server dataset was reset');
  }
}
const resetSchema = z.object({errorCode: z.literal('DATASET_RESET'), epoch: z.string().min(1)});
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
  private async call(url: string, init: RequestInit): Promise<Response> {
    const epoch = (await this.repository.db.meta.get('dataset-epoch'))?.value;
    const headers = new Headers(init.headers);
    headers.set('X-Dataset-Epoch', typeof epoch === 'string' ? epoch : 'initial');
    const response = await this.request(url, {...init, headers});
    if (response.status === 409) {
      const body = resetSchema.safeParse(await response.json().catch(() => null));
      if (body.success) throw new DatasetReset(body.data.epoch);
    }
    return response;
  }
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
      const response = await this.call('/api/v1/sync/operations', {
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
    let cursor = Number((await db.syncState.get(DELETES_CURSOR))?.value ?? 0);
    for (;;) {
      const response = await this.call('/api/v1/sync/changes?after=' + cursor + '&limit=100', {
        credentials: 'same-origin',
        headers: {'X-Sync-Body-Weight': '1', 'X-Sync-Workout-Deletes': '1'},
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
          (isDeleteKind(c.kind) ? c.payload !== null : c.payload?.id !== c.entityId)
        )
          throw new Error('Invalid change page');
        previous = c.changeSeq;
      }
      if (page.nextCursor !== previous || (page.hasMore && !page.changes.length))
        throw new Error('Invalid cursor');
      await db.transaction(
        'rw',
        [
          db.syncState,
          db.workouts,
          db.templates,
          db.bodyWeights,
          db.outbox,
          db.meta,
          db.importSources,
        ],
        async () => {
          for (const c of page.changes) {
            const pending = (await db.outbox.toArray()).some((o) => o.entityId === c.entityId);
            const old = Number((await db.syncState.get('revision:' + c.entityId))?.value ?? 0);
            if (c.revision >= old) {
              await db.syncState.put({key: 'revision:' + c.entityId, value: c.revision});
              if (!pending) {
                if (c.kind === 'putBodyWeight') await db.bodyWeights.put(c.payload as BodyWeight);
                else if (c.kind === 'putWorkout') await db.workouts.put(c.payload as Workout);
                else if (c.kind === 'deleteWorkout') await db.workouts.delete(c.entityId);
                else if (c.kind === 'putTemplate') {
                  await db.templates.put(c.payload as Workout);
                  await db.meta.put({key: 'templates-null', value: false});
                } else if (c.kind === 'deleteTemplate') await db.templates.delete(c.entityId);
                else {
                  await db.meta.put({key: 'imported-sync-active', value: true});
                  if (c.kind === 'putImportedWorkout')
                    await db.importSources.put({key: 'imported:' + c.entityId, value: c.payload});
                  else await db.importSources.delete('imported:' + c.entityId);
                }
              }
            }
          }
          // The legacy cursor stays current too, so a rolled-back app resumes from here.
          await db.syncState.put({key: 'cursor', value: page.nextCursor});
          await db.syncState.put({key: 'body-weight-cursor', value: page.nextCursor});
          await db.syncState.put({key: DELETES_CURSOR, value: page.nextCursor});
        },
      );
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
  }
}
