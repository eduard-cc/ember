import 'fake-indexeddb/auto';

import {expect, it, vi} from 'vitest';

import {parseBackup} from '../shared/backup';
import {BodyWeightSchema, LocalOperationSchema} from '../shared/contracts';
import {
  formatKg,
  fromLocalInput,
  parseKg,
  sortedMeasurements,
  toLocalInput,
} from '../src/domain/body-weight';
import {exportBackup, restoreBackup} from '../src/storage/backup';
import {commitStrongImport, prepareStrongImport} from '../src/storage/import';
import {WorkoutRepository} from '../src/storage/repository';
import {SyncEngine} from '../src/sync/engine';

// Synthetic values only.
const measurement = {
  id: 'synthetic-weight',
  date: '2020-02-29T09:15:00',
  kg: 80.25,
  deleted: false,
};
const repo = () => new WorkoutRepository('body-weight-' + crypto.randomUUID());
const adoptLegacyReset = async (repository: WorkoutRepository, epoch: string) => {
  const db = repository.db;
  // The bridge archives and clears known sync state, but leaves the unknown
  // bodyWeights table and body-weight-epoch metadata untouched.
  await db.meta.put({
    key: 'dataset-reset-archive:' + crypto.randomUUID(),
    value: {
      epoch: (await db.meta.get('dataset-epoch'))?.value ?? 'initial',
      resetAt: new Date().toISOString(),
      syncState: await db.syncState.toArray(),
      outbox: await db.outbox.toArray(),
    },
  });
  await db.syncState.clear();
  await db.outbox.clear();
  await db.meta.put({key: 'dataset-epoch', value: epoch});
};

it('accepts positive finite kg with at most two decimals and real local wall times', () => {
  expect(BodyWeightSchema.parse(measurement)).toEqual(measurement);
  for (const patch of [
    {kg: 0},
    {kg: -1},
    {kg: Infinity},
    {kg: NaN},
    {kg: 80.255},
    {kg: 501},
    {date: ''},
    {date: '2020-02-30T09:15:00'},
    {date: '2020-02-29T25:15:00'},
    {date: '2020-02-29T09:15:00Z'},
    {exercises: []},
  ])
    expect(
      BodyWeightSchema.safeParse({...measurement, ...patch}).success,
      JSON.stringify(patch),
    ).toBe(false);
  expect(BodyWeightSchema.safeParse({...measurement, kg: 80.35}).success).toBe(true);
  const operation = {
    operationId: crypto.randomUUID(),
    entityId: measurement.id,
    kind: 'putBodyWeight',
    expectedRevision: null,
    payload: measurement,
  };
  expect(LocalOperationSchema.safeParse(operation).success).toBe(true);
  expect(LocalOperationSchema.safeParse({...operation, kind: 'putWorkout'}).success).toBe(false);
  expect(
    LocalOperationSchema.safeParse({
      ...operation,
      payload: {id: measurement.id, name: 'x', date: '', duration: 0, exercises: []},
    }).success,
  ).toBe(false);
});

it('parses typed kg with a comma or point and rejects anything ambiguous', () => {
  expect(parseKg('80.2')).toBe(80.2);
  expect(parseKg(' 80,25 ')).toBe(80.25);
  for (const text of ['', '0', '-3', 'abc', '80.255', '1e2', '80.2.1', '600'])
    expect(parseKg(text)).toBeNull();
  expect(formatKg(80.2)).toBe('80.2');
  expect(formatKg(80)).toBe('80');
  expect(formatKg(80.25)).toBe('80.25');
});

it('round-trips datetime-local values as calendar-valid local wall times', () => {
  expect(fromLocalInput('2020-02-29T09:15')).toBe('2020-02-29T09:15:00');
  expect(fromLocalInput('2020-02-29T09:15:30')).toBe('2020-02-29T09:15:30');
  expect(fromLocalInput('2020-02-30T09:15')).toBeNull();
  expect(fromLocalInput('')).toBeNull();
  expect(toLocalInput('2020-02-29T09:15:00')).toBe('2020-02-29T09:15');
});

it('lists live measurements newest first and hides tombstones', () => {
  const list = [
    {...measurement, id: 'b', date: '2020-01-02T07:00:00'},
    {...measurement, id: 'a', date: '2020-01-02T07:00:00'},
    {...measurement, id: 'c', date: '2021-01-01T07:00:00'},
    {...measurement, id: 'd', date: '2022-01-01T07:00:00', deleted: true},
  ];
  expect(sortedMeasurements(list).map((m) => m.id)).toEqual(['c', 'b', 'a']);
});

it('durably adds, corrects and tombstones measurements without touching workout state', async () => {
  const repository = repo();
  const name = repository.db.name;
  const before = await repository.readState();
  await repository.putBodyWeight(measurement, null);
  const corrected = {...measurement, kg: 82.5, date: '2020-02-28T21:00:00'};
  await repository.putBodyWeight(corrected, measurement);
  await repository.putBodyWeight({...corrected, deleted: true}, corrected);
  expect(await repository.readState()).toEqual(before);
  const order = (await repository.db.syncState.get('queue-order'))?.value as string[];
  const operations = await repository.db.outbox.toArray();
  operations.sort((a, b) => order.indexOf(a.operationId) - order.indexOf(b.operationId));
  expect(operations.map((o) => [o.kind, o.expectedRevision])).toEqual([
    ['putBodyWeight', null],
    ['putBodyWeight', 1],
    ['putBodyWeight', 2],
  ]);
  repository.close();
  const reopened = new WorkoutRepository(name);
  expect(await reopened.db.bodyWeights.toArray()).toEqual([{...corrected, deleted: true}]);
  expect((await reopened.db.outbox.toArray()).length).toBe(3);
  reopened.close();
});

it('refuses stale bases, untrusted installations and failed outbox writes without partial state', async () => {
  const repository = repo();
  await repository.putBodyWeight(measurement, null);
  const corrected = {...measurement, kg: 83};
  await repository.putBodyWeight(corrected, measurement);
  await expect(repository.putBodyWeight({...measurement, kg: 84}, measurement)).rejects.toThrow(
    'changed',
  );
  const pending = await repository.db.outbox.toArray();
  const uuid = vi
    .spyOn(crypto, 'randomUUID')
    .mockReturnValue(pending[0].operationId as `${string}-${string}-${string}-${string}-${string}`);
  try {
    await expect(
      repository.putBodyWeight({...corrected, deleted: true}, corrected),
    ).rejects.toThrow();
  } finally {
    uuid.mockRestore();
  }
  expect(await repository.db.bodyWeights.get(measurement.id)).toEqual(corrected);
  expect(await repository.db.outbox.toArray()).toEqual(pending);
  await repository.db.meta.bulkPut([
    {key: 'ownerId', value: 'owner'},
    {key: 'local-trust', value: false},
  ]);
  await expect(repository.putBodyWeight({...measurement, id: 'locked'}, null)).rejects.toThrow(
    'Reconnect',
  );
  expect(await repository.db.bodyWeights.get('locked')).toBeUndefined();
  repository.close();
});

it('a Strong CSV replacement leaves measurements and their pending operations untouched', async () => {
  const repository = repo();
  await repository.putBodyWeight(measurement, null);
  const before = await repository.db.outbox.toArray();
  const csv =
    'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Seconds;Workout Duration;Notes\n2026-01-01 10:00:00;Synthetic;Press;1;20;kg;8;;30m;\n';
  await commitStrongImport(
    repository,
    await prepareStrongImport(new TextEncoder().encode(csv)),
    true,
  );
  expect(await repository.db.bodyWeights.toArray()).toEqual([measurement]);
  const after = await repository.db.outbox.toArray();
  expect(after.filter((o) => o.kind === 'putBodyWeight')).toEqual(before);
  repository.close();
});

it('recovery export round-trips measurements and tombstones as create-only operations', async () => {
  const repository = repo();
  await repository.putBodyWeight(measurement, null);
  const deleted = {...measurement, id: 'synthetic-deleted', deleted: true};
  await repository.putBodyWeight(deleted, null);
  const text = await exportBackup(repository);
  expect(parseBackup(text)).toMatchObject({version: 2});
  const restored = repo();
  await restoreBackup(restored, text);
  expect(await restored.db.bodyWeights.toArray()).toEqual(
    await repository.db.bodyWeights.toArray(),
  );
  const outbox = await restored.db.outbox.toArray();
  expect(outbox.map((o) => [o.kind, o.entityId, o.expectedRevision]).sort()).toEqual([
    ['putBodyWeight', 'synthetic-deleted', null],
    ['putBodyWeight', 'synthetic-weight', null],
  ]);
  repository.close();
  restored.close();
});

it('an old version 1 archive without measurements still restores, and malformed archives change nothing', async () => {
  const source = repo();
  await source.commitState({...(await source.readState()), templates: []});
  const v2 = JSON.parse(await exportBackup(source));
  const {bodyWeights, ...rest} = v2;
  expect(bodyWeights).toEqual([]);
  const v1 = JSON.stringify({...rest, version: 1});
  const target = repo();
  await target.putBodyWeight(measurement, null);
  const confirm = {replaceLocal: true, confirmation: 'REPLACE LOCAL DATA'};
  // Version/shape mismatches are refused before any write.
  for (const bad of [
    {...v2, version: 1},
    {...rest, version: 2},
    {...v2, bodyWeights: [{...measurement, kg: 0}]},
    {...v2, bodyWeights: [measurement, measurement]},
  ])
    await expect(restoreBackup(target, JSON.stringify(bad), confirm)).rejects.toThrow();
  expect(await target.db.bodyWeights.toArray()).toEqual([measurement]);
  await restoreBackup(target, v1, confirm);
  expect(await target.db.bodyWeights.count()).toBe(0);
  source.close();
  target.close();
});

it('pulls measurement changes from peers and refuses unknown record kinds without advancing', async () => {
  const repository = repo();
  const page = (changes: unknown[]) =>
    new Response(JSON.stringify({changes, nextCursor: changes.length ? 2 : 0, hasMore: false}));
  const engine = new SyncEngine(repository, async () =>
    page([
      {
        entityId: measurement.id,
        kind: 'putBodyWeight',
        revision: 1,
        changeSeq: 1,
        payload: measurement,
      },
      {
        entityId: measurement.id,
        kind: 'putBodyWeight',
        revision: 2,
        changeSeq: 2,
        payload: {...measurement, deleted: true},
      },
    ]),
  );
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect(await repository.db.bodyWeights.toArray()).toEqual([{...measurement, deleted: true}]);
  expect((await repository.db.syncState.get('revision:' + measurement.id))?.value).toBe(2);
  const unknown = new SyncEngine(
    repository,
    async () =>
      new Response(
        JSON.stringify({
          changes: [
            {
              entityId: 'future',
              kind: 'putFutureThing',
              revision: 1,
              changeSeq: 3,
              payload: {id: 'future'},
            },
          ],
          nextCursor: 3,
          hasMore: false,
        }),
      ),
  );
  await expect(unknown.sync({ownerId: 'owner', csrfToken: 'test'})).rejects.toThrow();
  expect((await repository.db.syncState.get('cursor'))?.value).toBe(2);
  const mismatched = new SyncEngine(repository, async () =>
    page([
      {
        entityId: 'w',
        kind: 'putBodyWeight',
        revision: 1,
        changeSeq: 3,
        payload: {...measurement, id: 'w', kg: -1},
      },
    ]),
  );
  await expect(mismatched.sync({ownerId: 'owner', csrfToken: 'test'})).rejects.toThrow();
  expect(await repository.db.bodyWeights.count()).toBe(1);
  repository.close();
});

it('an upgraded client opts in and replays measurements hidden behind its legacy cursor only once', async () => {
  const repository = repo();
  await repository.db.syncState.put({key: 'cursor', value: 99});
  const starts: number[] = [];
  const engine = new SyncEngine(repository, async (url, init) => {
    expect(new Headers(init?.headers).get('X-Sync-Body-Weight')).toBe('1');
    const after = Number(new URL(String(url), 'http://synthetic.test').searchParams.get('after'));
    starts.push(after);
    const changes =
      after === 0
        ? [
            {
              entityId: measurement.id,
              kind: 'putBodyWeight',
              revision: 1,
              changeSeq: 7,
              payload: measurement,
            },
          ]
        : [];
    return new Response(
      JSON.stringify({changes, nextCursor: changes.length ? 7 : after, hasMore: false}),
    );
  });
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect(await repository.readBodyWeights()).toEqual([measurement]);
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect(starts).toEqual([0, 7]);
  repository.close();
});

it('keeps its measurement cursor when a rolled-back app advances the legacy cursor', async () => {
  const repository = repo();
  const starts: number[] = [];
  let measurementExists = false;
  const engine = new SyncEngine(repository, async (url) => {
    const after = Number(new URL(String(url), 'http://synthetic.test').searchParams.get('after'));
    starts.push(after);
    const changes =
      measurementExists && after < 1
        ? [
            {
              entityId: measurement.id,
              kind: 'putBodyWeight',
              revision: 1,
              changeSeq: 1,
              payload: measurement,
            },
          ]
        : [];
    return new Response(
      JSON.stringify({changes, nextCursor: changes.length ? 1 : after, hasMore: false}),
    );
  });
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  // The bridge's old frontend skips a peer measurement and consumes a later
  // template at sequence 2, updating only the shared legacy cursor.
  measurementExists = true;
  await repository.db.syncState.put({key: 'cursor', value: 2});
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect(await repository.readBodyWeights()).toEqual([measurement]);
  expect(starts).toEqual([0, 0]);
  repository.close();
});

it.each(['putWorkout', 'putTemplate', 'putImportedWorkout', 'putBodyWeight'])(
  'refuses a valid but wrong payload for %s without writing a document or moving the cursor',
  async (kind) => {
    const repository = repo();
    await repository.db.syncState.put({key: 'cursor', value: 99});
    const payload =
      kind === 'putBodyWeight'
        ? {
            id: measurement.id,
            name: 'Synthetic',
            date: measurement.date,
            duration: 30,
            exercises: [],
          }
        : measurement;
    const engine = new SyncEngine(
      repository,
      async () =>
        new Response(
          JSON.stringify({
            changes: [{entityId: measurement.id, kind, revision: 1, changeSeq: 100, payload}],
            nextCursor: 100,
            hasMore: false,
          }),
        ),
    );
    await expect(engine.sync({ownerId: 'owner', csrfToken: 'test'})).rejects.toThrow();
    expect((await repository.db.syncState.get('cursor'))?.value).toBe(99);
    expect(await repository.db.workouts.count()).toBe(0);
    expect(await repository.db.templates.count()).toBe(0);
    expect(await repository.db.bodyWeights.count()).toBe(0);
    expect(await repository.db.importSources.count()).toBe(0);
    repository.close();
  },
);

it('upgrades a populated version 1 database without losing drafts, history, templates, evidence or pending writes', async () => {
  const {default: Dexie} = await import('dexie');
  const name = 'body-weight-upgrade-' + crypto.randomUUID();
  const legacy = new Dexie(name);
  legacy.version(1).stores({
    meta: '&key',
    drafts: '&key',
    workouts: '&id',
    templates: '&id',
    outbox: '&operationId',
    syncState: '&key',
    importSources: '&key',
  });
  const workout = {
    id: 'synthetic-history',
    name: 'Synthetic',
    date: measurement.date,
    duration: 30,
    exercises: [],
  };
  const operation = {
    operationId: crypto.randomUUID(),
    entityId: workout.id,
    kind: 'putWorkout',
    expectedRevision: null,
    payload: workout,
  };
  const records = {
    meta: [{key: 'finished-order', value: [workout.id]}],
    drafts: [{key: 'active', workout: {...workout, id: 'synthetic-draft'}}],
    workouts: [workout],
    templates: [{...workout, id: 'synthetic-template'}],
    outbox: [operation],
    syncState: [{key: 'cursor', value: 5}],
    importSources: [{key: 'legacy-v1', value: {raw: 'synthetic evidence', dataset: null}}],
  };
  for (const [table, rows] of Object.entries(records)) await legacy.table(table).bulkPut(rows);
  legacy.close();
  const upgraded = new WorkoutRepository(name);
  expect(await upgraded.readBodyWeights()).toEqual([]);
  for (const [table, rows] of Object.entries(records))
    expect(await upgraded.db.table(table).toArray()).toEqual(rows);
  await upgraded.putBodyWeight(measurement, null);
  expect(await upgraded.readBodyWeights()).toEqual([measurement]);
  expect(await upgraded.db.outbox.get(operation.operationId)).toEqual(operation);
  expect(await upgraded.readDraft()).toEqual(records.drafts[0].workout);
  upgraded.close();
});

it('a server dataset reset drops synced measurements but keeps and re-queues unsent ones', async () => {
  const repository = repo();
  const db = repository.db;
  await db.bodyWeights.put({...measurement, id: 'synced'});
  await db.syncState.put({key: 'revision:synced', value: 1});
  await repository.putBodyWeight({...measurement, id: 'unsent'}, null);
  await repository.resetToEpoch('epoch-2');
  expect((await db.meta.get('body-weight-epoch'))?.value).toBe('epoch-2');
  expect((await db.bodyWeights.toArray()).map((m) => m.id)).toEqual(['unsent']);
  expect((await db.outbox.toArray()).map((o) => [o.kind, o.entityId, o.expectedRevision])).toEqual([
    ['putBodyWeight', 'unsent', null],
  ]);
  const archive = (await db.meta.toArray()).find((r) => r.key.startsWith('dataset-reset-archive:'));
  expect((archive?.value as {bodyWeights: unknown[]}).bodyWeights).toHaveLength(2);
  repository.close();
});

it('does not re-upload measurements purged by a reset adopted while the legacy app ran', async () => {
  const repository = repo();
  const db = repository.db;
  await db.bodyWeights.put(measurement);
  await db.syncState.put({key: 'revision:' + measurement.id, value: 1});
  await repository.bootstrapSync();
  await adoptLegacyReset(repository, 'epoch-2');
  await repository.bootstrapSync();
  expect(await db.bodyWeights.count()).toBe(0);
  expect(await db.outbox.count()).toBe(0);
  const archive = (await db.meta.toArray()).find(
    (r) =>
      r.key.startsWith('dataset-reset-archive:') &&
      Array.isArray((r.value as {bodyWeights?: unknown[]}).bodyWeights),
  );
  expect((archive?.value as {bodyWeights: unknown[]}).bodyWeights).toEqual([measurement]);
  repository.close();
});

it('a new-frontend reset after a legacy reset still drops measurements purged by the legacy one', async () => {
  const repository = repo();
  const db = repository.db;
  const offline = {...measurement, id: 'offline'};
  await db.bodyWeights.bulkPut([measurement, offline]);
  await db.syncState.put({key: 'revision:' + measurement.id, value: 1});
  await repository.bootstrapSync();
  await adoptLegacyReset(repository, 'epoch-2');
  // The server resets again before the new frontend reopens; it adopts epoch-3
  // through resetToEpoch before bootstrapSync runs.
  await repository.resetToEpoch('epoch-3');
  await repository.bootstrapSync();
  expect(await db.bodyWeights.toArray()).toEqual([offline]);
  expect((await db.outbox.toArray()).map((o) => [o.entityId, o.expectedRevision])).toEqual([
    [offline.id, null],
  ]);
  repository.close();
});

it.each(['bootstrap', 'reset'])(
  'drops a measurement the legacy app uploaded in a later epoch before that epoch was reset (%s first)',
  async (first) => {
    const repository = repo();
    const db = repository.db;
    await repository.bootstrapSync();
    await adoptLegacyReset(repository, 'epoch-1');
    // Added offline on the new frontend, then uploaded by the rolled-back app in epoch-1.
    const later = {...measurement, id: 'later'};
    await repository.putBodyWeight(later, null);
    await db.outbox.clear();
    await db.syncState.put({key: 'revision:' + later.id, value: 1});
    await adoptLegacyReset(repository, 'epoch-2');
    if (first === 'reset') await repository.resetToEpoch('epoch-3');
    await repository.bootstrapSync();
    expect(await db.bodyWeights.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    repository.close();
  },
);

it('legacy reset reconciliation preserves never-acknowledged offline measurements and removes only purged pending writes', async () => {
  const repository = repo();
  const db = repository.db;
  await db.bodyWeights.put(measurement);
  await db.syncState.put({key: 'revision:' + measurement.id, value: 1});
  const offline = {...measurement, id: 'offline'};
  const corrected = {...offline, kg: 82};
  await repository.putBodyWeight(offline, null);
  await repository.putBodyWeight(corrected, offline);
  // A local update can expect revision 1 without any server acknowledgement.
  expect(new Set((await db.outbox.toArray()).map((o) => o.expectedRevision))).toEqual(
    new Set([null, 1]),
  );
  const unqueued = {...measurement, id: 'unqueued'};
  await db.bodyWeights.put(unqueued);
  // No bootstrap yet: the missing measurement epoch also means 'initial'.
  await adoptLegacyReset(repository, 'epoch-2');
  const pendingOffline = {...measurement, id: 'pending-offline'};
  await repository.putBodyWeight(pendingOffline, null);
  const keptOperations = await db.outbox.toArray();
  // A stale local correction must not resurrect an acknowledged, purged ID.
  const stale = {...measurement, kg: 83};
  await repository.putBodyWeight(stale, measurement);
  const purgedOperations = (await db.outbox.toArray()).filter((o) => o.entityId === measurement.id);

  await repository.bootstrapSync();
  expect(await db.bodyWeights.toArray()).toEqual([corrected, pendingOffline, unqueued]);
  const operations = await db.outbox.toArray();
  expect(operations).toEqual(expect.arrayContaining(keptOperations));
  expect(operations.map((o) => [o.entityId, o.expectedRevision]).sort()).toEqual([
    ['offline', null],
    ['pending-offline', null],
    ['unqueued', null],
  ]);
  const archive = (await db.meta.toArray()).find(
    (r) =>
      r.key.startsWith('dataset-reset-archive:') &&
      Array.isArray((r.value as {bodyWeights?: unknown[]}).bodyWeights),
  );
  expect(archive?.value).toMatchObject({bodyWeights: [stale], outbox: purgedOperations});
  expect((await db.meta.get('body-weight-epoch'))?.value).toBe('epoch-2');
  const metadata = await db.meta.toArray();
  await repository.bootstrapSync();
  expect(await db.outbox.toArray()).toEqual(operations);
  expect(await db.meta.toArray()).toEqual(metadata);
  repository.close();
});

it.each(['initial', 'epoch-1'])(
  'finds the acknowledgement from measurement epoch %s across multiple legacy resets',
  async (epoch) => {
    const repository = repo();
    const db = repository.db;
    if (epoch !== 'initial') await repository.resetToEpoch(epoch);
    const offline = {...measurement, id: 'offline'};
    await db.bodyWeights.bulkPut([measurement, offline]);
    await db.syncState.put({key: 'revision:' + measurement.id, value: 1});
    await repository.bootstrapSync();
    expect((await db.meta.get('body-weight-epoch'))?.value).toBe(epoch);
    // Evidence from another measurement epoch must not purge this offline entry.
    await db.meta.put({
      key: 'dataset-reset-archive:unrelated',
      value: {
        epoch: 'unrelated',
        resetAt: '2000-01-01T00:00:00.000Z',
        syncState: [{key: 'revision:' + offline.id, value: 1}],
      },
    });
    await adoptLegacyReset(repository, 'epoch-2');
    await adoptLegacyReset(repository, 'epoch-3');
    expect((await db.meta.get('body-weight-epoch'))?.value).toBe(epoch);

    await repository.bootstrapSync();
    expect(await db.bodyWeights.toArray()).toEqual([offline]);
    expect((await db.outbox.toArray()).map((o) => [o.entityId, o.expectedRevision])).toEqual([
      [offline.id, null],
    ]);
    expect((await db.meta.get('body-weight-epoch'))?.value).toBe('epoch-3');
    repository.close();
  },
);
