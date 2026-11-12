import {type Backup, parseBackup} from '../../shared/backup';
import type {WorkoutRepository} from './repository';

export async function restoreBackup(
  repository: WorkoutRepository,
  text: string,
  options: {replaceLocal?: boolean; confirmation?: string} = {},
): Promise<void> {
  const backup = parseBackup(text);
  const state = backup.state;
  await repository.flush();
  const db = repository.db;
  await db.transaction('rw', db.tables, async () => {
    const occupied = (await Promise.all(db.tables.map((table) => table.count()))).some(
      (count) => count > 0,
    );
    if (occupied && !(options.replaceLocal && options.confirmation === 'REPLACE LOCAL DATA'))
      throw new Error(
        'Restore requires a fresh database or explicit REPLACE LOCAL DATA confirmation',
      );
    const priorOwner = (await db.meta.get('ownerId'))?.value;
    const priorTrust = (await db.meta.get('local-trust'))?.value === true;
    if (priorOwner && backup.provenance.ownerId && priorOwner !== backup.provenance.ownerId)
      throw new Error('Backup belongs to a different owner');
    // Keep immutable source evidence even when deliberately replacing local working state.
    for (const table of db.tables) if (table.name !== 'importSources') await table.clear();
    for (const row of await db.importSources.toArray()) {
      if (row.key.startsWith('imported:') || row.key.startsWith('hash:')) {
        if (row.key.startsWith('hash:'))
          await db.importSources.add({
            key: `restore-evidence:${crypto.randomUUID()}:${row.key}`,
            value: row.value,
          });
        await db.importSources.delete(row.key);
      }
    }
    await db.meta.bulkPut([
      {key: 'installationId', value: crypto.randomUUID()},
      {key: 'legacy-migration', value: 'restored'},
      {key: 'templates-null', value: state.templates === null},
      {key: 'finished-order', value: state.finished.map((w) => w.id)},
      {key: 'template-order', value: state.templates?.map((w) => w.id) ?? []},
    ]);
    const ownerId = backup.provenance.ownerId ?? priorOwner;
    if (ownerId)
      await db.meta.bulkPut([
        {key: 'ownerId', value: ownerId},
        {key: 'local-trust', value: priorOwner === ownerId && priorTrust},
      ]);
    const priorDataset = await db.importSources.get('current-dataset');
    if (
      priorDataset &&
      (typeof (priorDataset.value as {raw?: unknown})?.raw === 'string' ||
        (priorDataset.value as {raw?: unknown})?.raw === null)
    )
      await db.importSources.add({
        key: `restore-evidence:${crypto.randomUUID()}:current-dataset`,
        value: priorDataset.value,
      });
    await db.importSources.put({key: 'current-dataset', value: {dataset: state.dataset}});
    for (const source of backup.sources) {
      const existing = await db.importSources.get(source.key);
      if (!existing)
        await db.importSources.add({
          key: source.key,
          value: {raw: source.raw, hash: source.hash, workoutIds: source.workoutIds},
        });
      else if ((existing.value as {raw?: unknown})?.raw !== source.raw)
        await db.importSources.add({
          key: `restore-evidence:${crypto.randomUUID()}:${source.key}`,
          value: {raw: source.raw, hash: source.hash, workoutIds: source.workoutIds},
        });
    }
    await db.bodyWeights.bulkAdd(backup.bodyWeights ?? []);
    await db.workouts.bulkAdd(state.finished);
    if (state.templates) await db.templates.bulkAdd(state.templates);
    if (state.active) await db.drafts.add({key: 'active', workout: state.active});
    await db.meta.put({key: 'imported-sync-active', value: state.dataset !== null});
    await db.importSources.bulkPut(
      (state.dataset?.workouts ?? []).map((workout) => ({
        key: 'imported:' + workout.id,
        value: workout,
      })),
    );
    const operations = [
      ...(backup.bodyWeights ?? []).map((measurement) => ({
        operationId: crypto.randomUUID(),
        entityId: measurement.id,
        kind: 'putBodyWeight' as const,
        expectedRevision: null,
        payload: measurement,
      })),
      ...(state.dataset?.workouts ?? []).map((workout) => ({
        operationId: crypto.randomUUID(),
        entityId: workout.id,
        kind: 'putImportedWorkout' as const,
        expectedRevision: null,
        payload: workout,
      })),
      ...state.finished.map((workout) => ({
        operationId: crypto.randomUUID(),
        entityId: workout.id,
        kind: 'putWorkout' as const,
        expectedRevision: null,
        payload: workout,
      })),
    ];
    await db.outbox.bulkAdd([
      ...operations,
      ...(state.templates ?? []).map((workout) => ({
        operationId: crypto.randomUUID(),
        entityId: workout.id,
        kind: 'putTemplate' as const,
        expectedRevision: null,
        payload: workout,
      })),
    ]);
  });
}
export async function exportBackup(repository: WorkoutRepository): Promise<string> {
  await repository.flush();
  const db = repository.db;
  return db.transaction('r', db.tables, async () => {
    const backup: Backup = {
      format: 'ember-backup',
      version: 2,
      bodyWeights: await db.bodyWeights.toArray(),
      exportedAt: new Date().toISOString(),
      state: await repository.readState(),
      sources: (await db.importSources.toArray()).flatMap((row) => {
        const value = row.value as {raw?: unknown; hash?: string; workoutIds?: string[]} | null;
        return value && (typeof value.raw === 'string' || value.raw === null)
          ? [
              {
                key: row.key,
                raw: value.raw,
                hash: value.hash ?? null,
                workoutIds: value.workoutIds ?? [],
              },
            ]
          : [];
      }),
      provenance: {
        ownerId: ((await db.meta.get('ownerId'))?.value as string) ?? null,
        cursor: ((await db.syncState.get('cursor'))?.value as number) ?? null,
        revisions: (await db.syncState.toArray())
          .filter((row) => row.key.startsWith('revision:'))
          .map((row) => ({
            entityId: row.key.slice('revision:'.length),
            revision: row.value as number,
          })),
      },
      draftOwnership: {
        installationId: ((await db.meta.get('installationId'))?.value as string) ?? null,
        policy: 'local-only-deliberate-restore',
      },
      pendingOperations: {
        label: 'diagnostic-only-not-restored',
        operations: await db.outbox.toArray(),
      },
    };
    const text = JSON.stringify(backup, null, 2);
    parseBackup(text);
    return text;
  });
}
