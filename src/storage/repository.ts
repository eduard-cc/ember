import {
  AppStateSchema,
  type BodyWeight,
  BodyWeightSchema,
  type LocalOperation,
  WorkoutSchema,
} from '../../shared/contracts';
import {countedSets} from '../domain/sets';
import type {Workout} from '../domain/types';
import {elapsedMinutes} from '../domain/workout-duration';
import type {AppState} from '../state/workout';
import {canonical} from './canonical';
import {GymDatabase} from './db';

export class WorkoutRepository {
  readonly db: GymDatabase;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    name = 'ember',
    private readonly now: () => number = () => Date.now(),
  ) {
    this.db = new GymDatabase(name);
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action);
    this.pending = next.catch(() => undefined);
    return next;
  }
  /** Connected to an owner but this device's trust was revoked: writes wait for a reconnect. */
  async needsReconnect(): Promise<boolean> {
    return (
      !!(await this.db.meta.get('ownerId'))?.value &&
      !(await this.db.meta.get('local-trust'))?.value
    );
  }
  async isDemo(): Promise<boolean> {
    return (await this.db.meta.get('demo-installation'))?.value === true;
  }
  /** The locally kept (pre-sync) imported dataset, from its current or legacy record. */
  private async storedDataset(): Promise<AppState['dataset'] | undefined> {
    const source =
      (await this.db.importSources.get('current-dataset')) ??
      (await this.db.importSources.get('legacy-v1'));
    return (source?.value as {dataset?: AppState['dataset']} | undefined)?.dataset;
  }
  private async importedWorkouts(): Promise<Workout[]> {
    return (await this.db.importSources.where('key').startsWith('imported:').toArray()).map(
      (r) => r.value as Workout,
    );
  }
  /** Sort rows by the id list stored under a meta key, when there is one. */
  private async sortByStoredOrder<T extends {id: string}>(key: string, rows: T[]): Promise<T[]> {
    const order = (await this.db.meta.get(key))?.value as string[] | undefined;
    if (order) {
      // First occurrence wins, as with indexOf.
      const rank = new Map(order.map((id, i) => [id, i] as const).reverse());
      rows.sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
    }
    return rows;
  }
  /** The server has a revision for the entity, or an operation for it is queued. */
  private async wasSent(id: string): Promise<boolean> {
    return (
      !!(await this.db.syncState.get('revision:' + id)) ||
      (await this.db.outbox.toArray()).some((o) => o.entityId === id)
    );
  }
  async queueOperation(
    kind: LocalOperation['kind'],
    entityId: string,
    payload: LocalOperation['payload'],
  ): Promise<void> {
    if ((kind === 'putTemplate' || kind === 'deleteTemplate') && (await this.isDemo())) return;
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
  /**
   * Add, correct or tombstone one body-weight measurement and queue its sync operation in
   * the same transaction. `base` is the version the owner saw; a newer stored version (for
   * example pulled from another device meanwhile) refuses the write rather than overwrite it.
   * Measurements are independent of workouts, templates and imports.
   */
  async putBodyWeight(measurement: BodyWeight, base: BodyWeight | null): Promise<void> {
    const snapshot = BodyWeightSchema.parse(measurement);
    const original = base ? BodyWeightSchema.parse(base) : null;
    return this.enqueue(() =>
      this.db.transaction(
        'rw',
        [this.db.meta, this.db.bodyWeights, this.db.outbox, this.db.syncState],
        async () => {
          if (await this.needsReconnect()) throw new Error('Reconnect before editing measurements');
          const stored = await this.db.bodyWeights.get(snapshot.id);
          if (JSON.stringify(stored ?? null) !== JSON.stringify(original))
            throw new Error('Measurement changed since it was displayed');
          if (JSON.stringify(snapshot) === JSON.stringify(original)) return;
          await this.db.bodyWeights.put(snapshot);
          await this.queueOperation('putBodyWeight', snapshot.id, snapshot);
        },
      ),
    );
  }
  async readBodyWeights(): Promise<BodyWeight[]> {
    return this.db.bodyWeights.toArray();
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
      duration: elapsedMinutes(parsed.date, this.now()),
      exercises: parsed.exercises
        .map((ex) => ({...ex, sets: countedSets(ex)}))
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
  /**
   * Owner edit of a finished or imported workout from History, or its deletion (`next` null).
   * Refused when the stored workout no longer matches what the editor displayed, so a peer's
   * synced change is never silently overwritten. Synced history queues a revisioned update
   * or tombstone; an import that never synchronized changes the local dataset copy only.
   */
  async changeHistoryWorkout(base: Workout, next: Workout | null): Promise<void> {
    const updated = next && WorkoutSchema.parse(next);
    if (updated && updated.id !== base.id) throw new Error('Workout identity changed');
    if (updated && !updated.exercises.some((ex) => ex.sets.length))
      throw new Error('A workout needs at least one set');
    const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
    return this.enqueue(() =>
      this.db.transaction(
        'rw',
        [this.db.meta, this.db.workouts, this.db.importSources, this.db.outbox, this.db.syncState],
        async () => {
          const changed = () => new Error('Workout changed since displayed; reopen it to edit');
          const native = await this.db.workouts.get(base.id);
          if (native) {
            if (!same(native, base)) throw changed();
            if (updated) {
              if (same(native, updated)) return;
              await this.db.workouts.put(updated);
              await this.queueOperation('putWorkout', base.id, updated);
              return;
            }
            await this.db.workouts.delete(base.id);
            const order = (await this.db.meta.get('finished-order'))?.value as string[] | undefined;
            if (order)
              await this.db.meta.put({
                key: 'finished-order',
                value: order.filter((id) => id !== base.id),
              });
            await this.queueTombstone('deleteWorkout', base.id);
            return;
          }
          if ((await this.db.meta.get('imported-sync-active'))?.value === true) {
            const record = await this.db.importSources.get('imported:' + base.id);
            if (!record) throw changed();
            if (!same(record.value, base)) throw changed();
            if (updated) {
              if (same(record.value, updated)) return;
              await this.db.importSources.put({key: record.key, value: updated});
              await this.queueOperation('putImportedWorkout', base.id, updated);
              return;
            }
            await this.db.importSources.delete(record.key);
            await this.queueTombstone('deleteImportedWorkout', base.id);
            return;
          }
          const dataset = await this.storedDataset();
          const workout = dataset?.workouts.find((w) => w.id === base.id);
          if (!dataset || !workout || !same(workout, base)) throw changed();
          await this.db.importSources.put({
            key: 'current-dataset',
            value: {
              dataset: {
                ...dataset,
                workouts: updated
                  ? dataset.workouts.map((w) => (w.id === base.id ? updated : w))
                  : dataset.workouts.filter((w) => w.id !== base.id),
              },
            },
          });
        },
      ),
    );
  }
  /**
   * A tombstone needs the server revision. A record the server never saw and has no pending
   * create was never sent, so dropping it locally is the whole deletion.
   */
  private async queueTombstone(kind: 'deleteWorkout' | 'deleteImportedWorkout', id: string) {
    if (await this.wasSent(id)) await this.queueOperation(kind, id, null);
  }
  async readState(): Promise<AppState> {
    return this.db.transaction(
      'r',
      [this.db.meta, this.db.drafts, this.db.workouts, this.db.templates, this.db.importSources],
      async () => {
        let dataset = (await this.storedDataset()) ?? null;
        const templates = await this.sortByStoredOrder(
          'template-order',
          await this.db.templates.toArray(),
        );
        const finished = await this.sortByStoredOrder(
          'finished-order',
          await this.db.workouts.toArray(),
        );
        if ((await this.db.meta.get('imported-sync-active'))?.value === true) {
          const imported = await this.importedWorkouts();
          dataset = {
            sourceLabel: dataset?.sourceLabel ?? 'Strong CSV',
            warnings: dataset?.warnings ?? {
              duplicateRows: 0,
              duplicateKeys: 0,
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
            if (canonical(persistedTemplates.find((t) => t.id === base.id)) !== canonical(base))
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
                    canonical(snapshot.templates?.find((t) => t.id === old.id)) !== canonical(old),
                )
                .map((t) => t.id),
              ...(snapshot.templates ?? [])
                .filter((t) => !oldTemplates.some((old) => old.id === t.id))
                .map((t) => t.id),
            ]);
            for (const id of changedIds) {
              if (
                canonical(persistedTemplates.find((t) => t.id === id)) !==
                canonical(oldTemplates.find((t) => t.id === id))
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
            if (canonical(template) !== canonical(old)) {
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
  /**
   * Legacy (pre-body-weight) frontends adopt dataset resets without seeing the
   * bodyWeights table, so its rows and body-weight-epoch outlive the reset. Their
   * private reset archives keep the revisions they cleared: measurements acknowledged
   * in the measurement epoch were purged by the server and must not be re-created.
   * Runs inside a transaction covering meta, bodyWeights and outbox; returns the
   * current dataset epoch.
   */
  private async dropLegacyPurgedMeasurements(): Promise<string> {
    const epoch = ((await this.db.meta.get('dataset-epoch'))?.value as string) ?? 'initial';
    const measurementEpoch = (await this.db.meta.get('body-weight-epoch'))?.value ?? 'initial';
    if (measurementEpoch === epoch) return epoch;
    // Every reset since the measurement epoch ended purged what it acknowledged,
    // including measurements a legacy app uploaded in a later epoch.
    const archives = (await this.db.meta.toArray())
      .filter((r) => r.key.startsWith('dataset-reset-archive:'))
      .map((r) => r.value as {epoch: string; resetAt?: string; syncState?: {key: string}[]});
    const since = archives
      .filter((a) => a.epoch === measurementEpoch && a.resetAt)
      .map((a) => a.resetAt!)
      .sort()[0];
    const acknowledged = new Set(
      archives
        .filter((a) => since !== undefined && a.resetAt !== undefined && a.resetAt >= since)
        .flatMap((archive) => archive.syncState ?? [])
        .filter((r) => r.key.startsWith('revision:'))
        .map((r) => r.key.slice(9)),
    );
    const purged = (await this.db.bodyWeights.toArray()).filter((m) => acknowledged.has(m.id));
    if (purged.length) {
      const ids = new Set(purged.map((m) => m.id));
      const outbox = (await this.db.outbox.toArray()).filter((o) => ids.has(o.entityId));
      await this.db.meta.put({
        key: 'dataset-reset-archive:' + crypto.randomUUID(),
        value: {
          epoch: measurementEpoch,
          resetAt: new Date().toISOString(),
          bodyWeights: purged,
          outbox,
        },
      });
      await this.db.bodyWeights.bulkDelete([...ids]);
      await this.db.outbox.bulkDelete(outbox.map((o) => o.operationId));
    }
    return epoch;
  }
  async bootstrapSync(): Promise<void> {
    await this.enqueue(async () => {
      await this.db.transaction(
        'rw',
        [
          this.db.meta,
          this.db.workouts,
          this.db.bodyWeights,
          this.db.templates,
          this.db.outbox,
          this.db.syncState,
          this.db.importSources,
        ],
        async () => {
          if (await this.isDemo())
            throw new Error(
              'Demo data cannot be synchronized. Use a separate empty browser profile for real data.',
            );
          const epoch = await this.dropLegacyPurgedMeasurements();
          if (!(await this.db.meta.get('imported-sync-active'))?.value) {
            const dataset = await this.storedDataset();
            if (dataset) {
              await this.db.importSources.bulkPut(
                dataset.workouts.map((workout) => ({
                  key: 'imported:' + workout.id,
                  value: workout,
                })),
              );
              await this.db.meta.put({key: 'imported-sync-active', value: true});
            }
          }
          // Read what was already sent once; nothing below writes revisions, and each
          // queued record joins the pending set.
          const sent = new Set([
            ...(await this.db.syncState.where('key').startsWith('revision:').primaryKeys()).map(
              (key) => key.slice(9),
            ),
            ...(await this.db.outbox.toArray()).map((o) => o.entityId),
          ]);
          for (const [kind, records] of [
            ['putBodyWeight', await this.db.bodyWeights.toArray()],
            ['putWorkout', await this.db.workouts.toArray()],
            ['putTemplate', await this.db.templates.toArray()],
            ['putImportedWorkout', await this.importedWorkouts()],
          ] as const) {
            for (const record of records)
              if (!sent.has(record.id)) {
                await this.queueOperation(kind, record.id, record);
                sent.add(record.id);
              }
          }
          await this.db.meta.put({key: 'body-weight-epoch', value: epoch});
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
        [
          db.meta,
          db.workouts,
          db.templates,
          db.bodyWeights,
          db.outbox,
          db.syncState,
          db.importSources,
        ],
        async () => {
          await this.dropLegacyPurgedMeasurements();
          // Keep a private, non-replayed snapshot before dropping stale synced copies.
          // Offline template/import edits and legacy evidence remain recoverable here.
          const outbox = await db.outbox.toArray();
          const syncState = await db.syncState.toArray();
          const workouts = await db.workouts.toArray();
          const templates = await db.templates.toArray();
          const importSources = await db.importSources.toArray();
          const bodyWeights = await db.bodyWeights.toArray();
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
              bodyWeights,
            },
          });
          const acknowledged = new Set(
            syncState.filter((r) => r.key.startsWith('revision:')).map((r) => r.key.slice(9)),
          );
          // Only pending creates never reached the server; a pending edit
          // (expectedRevision set) belongs to an acknowledged workout the reset purged.
          const unsent = new Set(
            outbox
              .filter((o) => o.kind === 'putWorkout' && o.expectedRevision === null)
              .map((o) => o.entityId),
          );
          const kept = workouts.filter((w) => unsent.has(w.id) || !acknowledged.has(w.id));
          for (const w of kept) unsent.add(w.id);
          // Measurements follow the same rule: only ones the server never acknowledged
          // survive a reset (their latest local state is re-created there).
          const keptMeasurements = bodyWeights.filter((m) => !acknowledged.has(m.id));
          await Promise.all([
            db.workouts.clear(),
            db.templates.clear(),
            db.bodyWeights.clear(),
            db.outbox.clear(),
            db.syncState.clear(),
            db.importSources.clear(),
          ]);
          for (const workout of kept) {
            await db.workouts.add(workout);
            await this.queueOperation('putWorkout', workout.id, workout);
          }
          for (const measurement of keptMeasurements) {
            await db.bodyWeights.add(measurement);
            await this.queueOperation('putBodyWeight', measurement.id, measurement);
          }
          const order =
            ((await db.meta.get('finished-order'))?.value as string[] | undefined) ?? [];
          await db.meta.put({key: 'finished-order', value: order.filter((id) => unsent.has(id))});
          await db.meta.put({key: 'template-order', value: []});
          await db.meta.put({key: 'templates-null', value: false});
          // Imported history now arrives only from the server feed; nothing local re-uploads.
          await db.meta.put({key: 'imported-sync-active', value: true});
          await db.meta.put({key: 'dataset-epoch', value: epoch});
          await db.meta.put({key: 'body-weight-epoch', value: epoch});
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
