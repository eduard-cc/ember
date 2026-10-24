import 'fake-indexeddb/auto';

import {describe, expect, it, vi} from 'vitest';

import type {Workout} from '../src/domain/types';
import {WorkoutRepository} from '../src/storage/repository';

export const fixture: Workout = {
  id: 'source:occurrence:1',
  name: 'Synthetic',
  date: '2026-01-10T12:00:00',
  duration: 40,
  exercises: [
    {
      name: 'Press',
      type: 'weighted',
      sets: [
        {
          id: 'row-1-original',
          weight: 30,
          reps: 8,
          seconds: null,
          distance: null,
          original: {Weight: '30.00', Reps: '8'},
        },
      ],
    },
  ],
};
describe('durable repository', () => {
  it('atomically saves elapsed minutes in history and the queued workout without changing past durations', async () => {
    const repository = new WorkoutRepository(`test-${crypto.randomUUID()}`, () =>
      new Date('2026-01-10T12:45:59').getTime(),
    );
    const past = {...fixture, id: 'past-workout', duration: 0};
    const imported = {...fixture, id: 'imported-workout', duration: 62.5};
    const active = {
      ...fixture,
      duration: 0,
      exercises: [
        {...fixture.exercises[0], sets: [{...fixture.exercises[0].sets[0], completed: true}]},
      ],
    };
    await repository.db.workouts.add(past);
    await repository.commitState({
      version: 1,
      dataset: {
        sourceLabel: 'Synthetic import',
        workouts: [imported],
        warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
      },
      active,
      finished: [past],
      templates: [],
    });
    const finished = await repository.finishWorkout(active);
    expect(finished.duration).toBe(45);
    expect(await repository.db.workouts.get(active.id)).toEqual(finished);
    expect(await repository.db.outbox.toArray()).toMatchObject([
      {kind: 'putWorkout', entityId: active.id, payload: finished},
    ]);
    const state = await repository.readState();
    expect(state.active).toBeNull();
    expect(state.finished.find((w) => w.id === past.id)).toEqual(past);
    expect(state.dataset?.workouts).toEqual([imported]);
    expect(active.duration).toBe(0);
    repository.close();
  });
  it('saves a sub-minute finish as a nonzero fraction in history and the queued workout', async () => {
    const repository = new WorkoutRepository(`test-${crypto.randomUUID()}`, () =>
      new Date('2026-01-10T12:00:30').getTime(),
    );
    const active = {
      ...fixture,
      duration: 0,
      exercises: [
        {...fixture.exercises[0], sets: [{...fixture.exercises[0].sets[0], completed: true}]},
      ],
    };
    await repository.commitDraft(active);
    const finished = await repository.finishWorkout(active);
    expect(finished.duration).toBe(0.5);
    expect(await repository.db.workouts.get(active.id)).toEqual(finished);
    expect(await repository.db.outbox.toArray()).toMatchObject([
      {kind: 'putWorkout', entityId: active.id, payload: {duration: 0.5}},
    ]);
    repository.close();
  });
  it('checks the original editor document even when previous state has refreshed to the peer winner', async () => {
    const repository = new WorkoutRepository(`test-${crypto.randomUUID()}`);
    const initial = {
      version: 1 as const,
      dataset: null,
      active: null,
      finished: [],
      templates: [fixture],
    };
    await repository.commitState(initial);
    const pending = await repository.db.outbox.toArray();
    const peer = {
      ...fixture,
      exercises: [{...fixture.exercises[0], sets: [{...fixture.exercises[0].sets[0], weight: 99}]}],
    };
    await repository.db.templates.put(peer);
    await repository.db.syncState.put({key: 'revision:' + fixture.id, value: 2});
    const refreshed = await repository.readState();
    const edited = {...refreshed, templates: [{...fixture, name: 'Retained rename'}]};
    await expect(repository.commitState(edited, refreshed, [fixture])).rejects.toThrow(
      'Template changed',
    );
    expect(await repository.db.templates.get(fixture.id)).toEqual(peer);
    expect(await repository.db.outbox.toArray()).toEqual(pending);
    expect((await repository.db.syncState.get('revision:' + fixture.id))?.value).toBe(2);
    repository.close();
  });
  it('rejects a displayed template base after a hidden peer set-value update without clearing queued work', async () => {
    const repository = new WorkoutRepository(`test-${crypto.randomUUID()}`);
    const displayed = {
      version: 1 as const,
      dataset: null,
      active: null,
      finished: [],
      templates: [fixture],
    };
    await repository.commitState(displayed);
    const pending = await repository.db.outbox.toArray();
    const peer = {
      ...fixture,
      exercises: [{...fixture.exercises[0], sets: [{...fixture.exercises[0].sets[0], weight: 99}]}],
    };
    await repository.db.templates.put(peer);
    await repository.db.syncState.put({key: 'revision:' + fixture.id, value: 2});
    const edited = {...displayed, templates: [{...fixture, name: 'Retained UI rename'}]};
    await expect(repository.commitState(edited, displayed)).rejects.toThrow('Template changed');
    expect(await repository.db.templates.get(fixture.id)).toEqual(peer);
    expect(await repository.db.outbox.toArray()).toEqual(pending);
    expect(edited.templates[0].name).toBe('Retained UI rename');
    repository.close();
  });
  it('saves a template edit when the stored copy has the same content in another key order', async () => {
    const repository = new WorkoutRepository(`test-${crypto.randomUUID()}`);
    const displayed = {
      version: 1 as const,
      dataset: null,
      active: null,
      finished: [],
      templates: [fixture],
    };
    await repository.commitState(displayed);
    const reversed = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reversed)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, entry]) => [key, reversed(entry)]),
            )
          : value;
    await repository.db.templates.put(reversed(fixture) as Workout);
    const renamed = {...fixture, name: 'Renamed routine'};
    await repository.commitState({...displayed, templates: [renamed]}, displayed, [fixture]);
    expect(await repository.db.templates.get(fixture.id)).toEqual(renamed);
    expect(
      (await repository.db.outbox.toArray()).map(({kind, entityId, payload}) => ({
        kind,
        entityId,
        name: (payload as Workout).name,
      })),
    ).toContainEqual({kind: 'putTemplate', entityId: fixture.id, name: 'Renamed routine'});
    repository.close();
  });
  it('rolls back inserted workout when outbox insert violates its real unique index', async () => {
    const repository = new WorkoutRepository(`test-${crypto.randomUUID()}`);
    const active = {
      ...fixture,
      exercises: [
        {...fixture.exercises[0], sets: [{...fixture.exercises[0].sets[0], completed: true}]},
      ],
    };
    await repository.commitDraft(active);
    const operationId = crypto.randomUUID();
    const originalOperation = {
      operationId,
      entityId: 'existing',
      kind: 'deleteTemplate' as const,
      expectedRevision: 1,
      payload: null,
    };
    await repository.db.outbox.add(originalOperation);
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId);
    try {
      await expect(repository.finishWorkout(active)).rejects.toThrow();
    } finally {
      uuid.mockRestore();
    }
    expect(await repository.readDraft()).toEqual(active);
    expect(await repository.db.workouts.count()).toBe(0);
    expect(await repository.db.outbox.toArray()).toEqual([originalOperation]);
    await repository.finishWorkout(active);
    expect(await repository.db.workouts.count()).toBe(1);
    repository.close();
  });
  it('serializes edits then atomically finishes valid completed sets and immutable outbox', async () => {
    const repository = new WorkoutRepository(`test-${crypto.randomUUID()}`);
    const active = {
      ...fixture,
      exercises: [
        {
          ...fixture.exercises[0],
          sets: [
            {...fixture.exercises[0].sets[0], completed: true},
            {...fixture.exercises[0].sets[0], id: 'uncompleted', completed: false},
            {...fixture.exercises[0].sets[0], id: 'invalid', reps: 0, completed: true},
          ],
        },
      ],
    };
    const pendingSave = repository.commitDraft(active);
    const finished = await repository.finishWorkout(active);
    await pendingSave;
    expect(await repository.readDraft()).toBeNull();
    expect(await repository.db.workouts.toArray()).toEqual([finished]);
    const [operation] = await repository.db.outbox.toArray();
    expect(operation).toMatchObject({
      entityId: active.id,
      kind: 'putWorkout',
      expectedRevision: null,
      payload: finished,
    });
    expect(finished.exercises[0].sets.map((set) => set.id)).toEqual(['row-1-original']);
    active.name = 'mutated after finish';
    expect(await repository.db.outbox.toArray()).toEqual([operation]);
    await expect(repository.finishWorkout(fixture)).rejects.toThrow();
    repository.close();
  });
  it('rejects malformed drafts without touching existing durable data', async () => {
    const repository = new WorkoutRepository(`test-${crypto.randomUUID()}`);
    await repository.commitDraft(fixture);
    for (const patch of [
      {duration: Infinity},
      {
        exercises: [
          {...fixture.exercises[0], sets: [{...fixture.exercises[0].sets[0], reps: '8'}]},
        ],
      },
      {unexpected: true},
    ]) {
      await expect(repository.commitDraft({...fixture, ...patch} as Workout)).rejects.toThrow();
      expect(await repository.readDraft()).toEqual(fixture);
    }
    repository.close();
  });
  it('acknowledges a draft only after it survives reopening IndexedDB', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const repository = new WorkoutRepository(name);
    await repository.commitDraft(fixture);
    repository.close();
    const reopened = new WorkoutRepository(name);
    expect(await reopened.readDraft()).toEqual(fixture);
    reopened.close();
  });
});
