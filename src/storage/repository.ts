import {AppStateSchema, type LocalOperation, WorkoutSchema} from '../../shared/contracts';
import type {Workout} from '../domain/types';
import type {AppState} from '../state/workout';
import {validSet} from '../views/WorkoutView';
import {GymDatabase} from './db';

export class WorkoutRepository {
  readonly db: GymDatabase;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(name = 'gym-log') {
    this.db = new GymDatabase(name);
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action);
    this.pending = next.catch(() => undefined);
    return next;
  }
  async queueOperation(
    kind: LocalOperation['kind'],
    entityId: string,
    payload: Workout | null,
  ): Promise<void> {
    if (
      (kind === 'putTemplate' || kind === 'deleteTemplate') &&
      (await this.db.meta.get('demo-installation'))?.value === true
    )
      return;
    const pending = (await this.db.outbox.toArray()).filter((o) => o.entityId === entityId);
    const revision = Number((await this.db.syncState.get('revision:' + entityId))?.value ?? 0);
    const expectedRevision = pending.length
      ? Math.max(...pending.map((o) => (o.expectedRevision ?? 0) + 1))
      : revision || null;
    const operation = {operationId: crypto.randomUUID(), entityId, kind, expectedRevision, payload};
    await this.db.outbox.add(operation);
    const order = (await this.db.syncState.get('queue-order'))?.value as string[] | undefined;
    await this.db.syncState.put({
      key: 'queue-order',
      value: [...(order ?? []), operation.operationId],
    });
  }
  async commitDraft(workout: Workout): Promise<void> {
    const snapshot = WorkoutSchema.parse(workout);
    return this.enqueue(async () => {
      await this.db.transaction('rw', this.db.drafts, async () => {
        await this.db.drafts.put({key: 'active', workout: snapshot});
      });
    });
  }
  async finishWorkout(workout: Workout): Promise<Workout> {
    const parsed = WorkoutSchema.parse(workout);
    const finished = {
      ...parsed,
      exercises: parsed.exercises
        .map((ex) => ({
          ...ex,
          sets: ex.sets.filter((set) => set.completed && validSet(set, ex.type)),
        }))
        .filter((ex) => ex.sets.length),
    };
    if (!finished.exercises.length) throw new Error('No valid completed sets');

    return this.enqueue(async () => {
      await this.db.transaction(
        'rw',
        [this.db.meta, this.db.drafts, this.db.workouts, this.db.outbox, this.db.syncState],
        async () => {
          const draft = await this.db.drafts.get('active');
          if (draft?.workout.id !== finished.id) throw new Error('Active draft changed');
          await this.db.workouts.add(finished);
          await this.queueOperation('putWorkout', finished.id, finished);
          await this.db.drafts.delete('active');
          const order = (await this.db.meta.get('finished-order'))?.value as string[] | undefined;
          await this.db.meta.put({key: 'finished-order', value: [finished.id, ...(order ?? [])]});
        },
      );
      return finished;
    });
  }
  async readState(): Promise<AppState> {
    return this.db.transaction(
      'r',
      [this.db.meta, this.db.drafts, this.db.workouts, this.db.templates, this.db.importSources],
      async () => {
        const source =
          (await this.db.importSources.get('current-dataset')) ??
          (await this.db.importSources.get('legacy-v1'));
        const value = source?.value as {dataset?: AppState['dataset']} | undefined;
        const templates = await this.db.templates.toArray();
        const order = (await this.db.meta.get('template-order'))?.value as string[] | undefined;
        if (order) templates.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        const finished = await this.db.workouts.toArray();
        const finishedOrder = (await this.db.meta.get('finished-order'))?.value as
          string[] | undefined;
        if (finishedOrder)
          finished.sort((a, b) => finishedOrder.indexOf(a.id) - finishedOrder.indexOf(b.id));
        let dataset = value?.dataset ?? null;
        if ((await this.db.meta.get('imported-sync-active'))?.value === true) {
          const imported = (await this.db.importSources.toArray())
            .filter((r) => r.key.startsWith('imported:'))
            .map((r) => r.value as Workout);
          dataset = {
            sourceLabel: dataset?.sourceLabel ?? 'Strong CSV',
            warnings: dataset?.warnings ?? {
              duplicateRows: 0,
              duplicateKeys: 0,
              suspiciousRows: 0,
              unparsedRows: 0,
            },
            workouts: imported.sort((a, b) => b.date.localeCompare(a.date)),
          };
        }
        return AppStateSchema.parse({
          version: 1,
          dataset,
          active: await this.readDraft(),
          finished,
          templates: (await this.db.meta.get('templates-null'))?.value === true ? null : templates,
        });
      },
    );
  }
  async commitState(
    state: AppState,
    previous?: AppState,
    templateBases: readonly Workout[] = [],
  ): Promise<void> {
    const snapshot = AppStateSchema.parse(state);
    return this.enqueue(async () => {
      await this.db.transaction(
        'rw',
        [
          this.db.meta,
          this.db.drafts,
          this.db.templates,
          this.db.importSources,
          this.db.outbox,
          this.db.syncState,
        ],
        async () => {
          if (snapshot.active) await this.db.drafts.put({key: 'active', workout: snapshot.active});
          else await this.db.drafts.delete('active');
          // Only explicit template/import edits replace those documents. Completed history
          // is never written by this generic path; finish owns its atomic transaction.
          const persistedTemplates = await this.db.templates.toArray();
          for (const base of templateBases) {
            if (
              JSON.stringify(persistedTemplates.find((t) => t.id === base.id)) !==
              JSON.stringify(base)
            )
              throw new Error('Template changed since displayed; local edits kept');
          }
          const oldTemplates = previous ? (previous.templates ?? []) : persistedTemplates;
          // Validate only edited/deleted documents, inside the same transaction that
          // reads their revision and queues the mutation. A retained UI base is not
          // permission to overwrite a newer document pulled before UI refresh.
          if (previous) {
            const changedIds = new Set([
              ...oldTemplates
                .filter(
                  (old) =>
                    JSON.stringify(snapshot.templates?.find((t) => t.id === old.id)) !==
                    JSON.stringify(old),
                )
                .map((t) => t.id),
              ...(snapshot.templates ?? [])
                .filter((t) => !oldTemplates.some((old) => old.id === t.id))
                .map((t) => t.id),
            ]);
            for (const id of changedIds) {
              if (
                JSON.stringify(persistedTemplates.find((t) => t.id === id)) !==
                JSON.stringify(oldTemplates.find((t) => t.id === id))
              )
                throw new Error('Template changed since displayed; local edits kept');
            }
          }
          for (const old of oldTemplates)
            if (!snapshot.templates?.some((t) => t.id === old.id)) {
              await this.db.templates.delete(old.id);
              await this.queueOperation('deleteTemplate', old.id, null);
            }
          for (const template of snapshot.templates ?? []) {
            const old = oldTemplates.find((t) => t.id === template.id);
            if (JSON.stringify(template) !== JSON.stringify(old)) {
              if (old) await this.db.templates.put(template);
              else await this.db.templates.add(template);
              await this.queueOperation('putTemplate', template.id, template);
            }
          }
          if (!previous || state.templates !== previous.templates) {
            await this.db.meta.put({key: 'templates-null', value: snapshot.templates === null});
            await this.db.meta.put({
              key: 'template-order',
              value: snapshot.templates?.map((workout) => workout.id) ?? [],
            });
          }
          if (!previous || state.dataset !== previous.dataset)
            await this.db.importSources.put({
              key: 'current-dataset',
              value: {dataset: snapshot.dataset},
            });
        },
      );
    });
  }
  async bootstrapSync(): Promise<void> {
    await this.enqueue(async () => {
      await this.db.transaction(
        'rw',
        [
          this.db.meta,
          this.db.workouts,
          this.db.templates,
          this.db.outbox,
          this.db.syncState,
          this.db.importSources,
        ],
        async () => {
          if ((await this.db.meta.get('demo-installation'))?.value === true)
            throw new Error(
              'Demo data cannot be synchronized. Use a separate empty browser profile for real data.',
            );
          if (!(await this.db.meta.get('imported-sync-active'))?.value) {
            const source =
              (await this.db.importSources.get('current-dataset')) ??
              (await this.db.importSources.get('legacy-v1'));
            const dataset = (source?.value as {dataset?: AppState['dataset']} | undefined)?.dataset;
            if (dataset) {
              for (const workout of dataset.workouts)
                await this.db.importSources.put({key: 'imported:' + workout.id, value: workout});
              await this.db.meta.put({key: 'imported-sync-active', value: true});
            }
          }
          const imported = (await this.db.importSources.toArray())
            .filter((r) => r.key.startsWith('imported:'))
            .map((r) => r.value as Workout);
          for (const [kind, records] of [
            ['putWorkout', await this.db.workouts.toArray()],
            ['putTemplate', await this.db.templates.toArray()],
            ['putImportedWorkout', imported],
          ] as const) {
            for (const record of records)
              if (
                !(await this.db.syncState.get('revision:' + record.id)) &&
                !(await this.db.outbox.toArray()).some((o) => o.entityId === record.id)
              )
                await this.queueOperation(kind, record.id, record);
          }
        },
      );
    });
  }
  /**
   * Adopt a server dataset reset: drop every synced copy (history, imports, templates,
   * revisions, cursor, retained issues) so purged data is neither shown nor re-uploaded.
   * The device-local active draft and finished workouts that never reached the server
   * are kept; the latter are re-queued as fresh creates for the new dataset.
   */
  async resetToEpoch(epoch: string): Promise<void> {
    await this.enqueue(async () => {
      const db = this.db;
      await db.transaction(
        'rw',
        [db.meta, db.workouts, db.templates, db.outbox, db.syncState, db.importSources],
        async () => {
          // Keep a private, non-replayed snapshot before dropping stale synced copies.
          // Offline template/import edits and legacy evidence remain recoverable here.
          const outbox = await db.outbox.toArray();
          const syncState = await db.syncState.toArray();
          const workouts = await db.workouts.toArray();
          const templates = await db.templates.toArray();
          const importSources = await db.importSources.toArray();
          await db.meta.put({
            key: 'dataset-reset-archive:' + crypto.randomUUID(),
            value: {
              epoch: (await db.meta.get('dataset-epoch'))?.value ?? 'initial',
              resetAt: new Date().toISOString(),
              outbox,
              syncState,
              workouts,
              templates,
              importSources,
            },
          });
          const acknowledged = new Set(
            syncState.filter((r) => r.key.startsWith('revision:')).map((r) => r.key.slice(9)),
          );
          const unsent = new Set(
            outbox.filter((o) => o.kind === 'putWorkout').map((o) => o.entityId),
          );
          const kept = workouts.filter((w) => unsent.has(w.id) || !acknowledged.has(w.id));
          for (const w of kept) unsent.add(w.id);
          await Promise.all([
            db.workouts.clear(),
            db.templates.clear(),
            db.outbox.clear(),
            db.syncState.clear(),
            db.importSources.clear(),
          ]);
          for (const workout of kept) {
            await db.workouts.add(workout);
            await this.queueOperation('putWorkout', workout.id, workout);
          }
          const order =
            ((await db.meta.get('finished-order'))?.value as string[] | undefined) ?? [];
          await db.meta.put({key: 'finished-order', value: order.filter((id) => unsent.has(id))});
          await db.meta.put({key: 'template-order', value: []});
          await db.meta.put({key: 'templates-null', value: false});
          // Imported history now arrives only from the server feed; nothing local re-uploads.
          await db.meta.put({key: 'imported-sync-active', value: true});
          await db.meta.put({key: 'dataset-epoch', value: epoch});
        },
      );
    });
  }
  async readDraft(): Promise<Workout | null> {
    return (await this.db.drafts.get('active'))?.workout ?? null;
  }
  async flush(): Promise<void> {
    await this.pending;
  }
  close() {
    this.db.close();
  }
}
