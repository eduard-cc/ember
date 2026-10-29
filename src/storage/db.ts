import Dexie, {type Table} from 'dexie';

import type {BodyWeight, LocalOperation} from '../../shared/contracts';
import type {Workout} from '../domain/types';
import {stripImportSource, stripWorkout} from './retired-fields';

export class GymDatabase extends Dexie {
  meta!: Table<{key: string; value: unknown}, string>;
  drafts!: Table<{key: string; workout: Workout}, string>;
  workouts!: Table<Workout, string>;
  templates!: Table<Workout, string>;
  bodyWeights!: Table<BodyWeight, string>;
  outbox!: Table<LocalOperation, string>;
  syncState!: Table<{key: string; value: unknown}, string>;
  importSources!: Table<{key: string; value: unknown}, string>;
  constructor(name = 'ember') {
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
    this.version(2).stores({bodyWeights: '&id'});
    // Sets no longer carry `excluded`/`suspicious`; stored copies drop them once.
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        for (const table of ['workouts', 'templates'])
          await tx
            .table(table)
            .toCollection()
            .modify((workout) => void stripWorkout(workout));
        await tx
          .table('drafts')
          .toCollection()
          .modify((draft: {workout: unknown}) => void stripWorkout(draft.workout));
        await tx
          .table('outbox')
          .toCollection()
          .modify((operation: {payload: unknown}) => void stripWorkout(operation.payload));
        await tx
          .table('importSources')
          .toCollection()
          .modify(
            (row: {key: string; value: unknown}) => void stripImportSource(row.key, row.value),
          );
      });
  }
}
