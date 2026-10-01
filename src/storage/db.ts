import Dexie, {type Table} from 'dexie';

import type {LocalOperation} from '../../shared/contracts';
import type {Workout} from '../domain/types';

export class GymDatabase extends Dexie {
  meta!: Table<{key: string; value: unknown}, string>;
  drafts!: Table<{key: string; workout: Workout}, string>;
  workouts!: Table<Workout, string>;
  templates!: Table<Workout, string>;
  outbox!: Table<LocalOperation, string>;
  syncState!: Table<{key: string; value: unknown}, string>;
  importSources!: Table<{key: string; value: unknown}, string>;
  constructor(name = 'gym-log') {
    super(name);
    this.version(1).stores({
      meta: '&key',
      drafts: '&key',
      workouts: '&id',
      templates: '&id',
      outbox: '&operationId',
      syncState: '&key',
      importSources: '&key',
    });
  }
}
