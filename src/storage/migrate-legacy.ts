import {AppStateSchema} from '../../shared/contracts';
import type {WorkoutRepository} from './repository';

export async function migrateLegacy(
  repository: WorkoutRepository,
  raw: string | null,
): Promise<'none' | 'migrated' | 'blocked'> {
  if (raw === null || (await repository.db.meta.get('legacy-migration'))) return 'none';
  let state;
  try {
    state = AppStateSchema.parse(JSON.parse(raw));
  } catch {
    return 'blocked';
  }
  const db = repository.db;
  return db.transaction(
    'rw',
    [db.meta, db.drafts, db.workouts, db.templates, db.importSources],
    async () => {
      if (await db.meta.get('legacy-migration')) return 'none';
      if (state.active) await db.drafts.add({key: 'active', workout: state.active});
      await db.workouts.bulkAdd(state.finished);
      if (state.templates) await db.templates.bulkAdd(state.templates);
      await db.importSources.add({key: 'legacy-v1', value: {raw, dataset: state.dataset}});
      await db.meta.put({key: 'templates-null', value: state.templates === null});
      await db.meta.put({
        key: 'template-order',
        value: state.templates?.map((workout) => workout.id) ?? [],
      });
      await db.meta.put({
        key: 'finished-order',
        value: state.finished.map((workout) => workout.id),
      });
      await db.meta.add({key: 'legacy-migration', value: true});
      return 'migrated';
    },
  );
}
