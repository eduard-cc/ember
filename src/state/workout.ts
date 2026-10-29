import {useCallback, useEffect, useRef, useState} from 'react';

import {demoDataset, demoTemplates} from '../domain/demo';
import type {Dataset, Workout} from '../domain/types';
import {type DraftLock, acquireDraftLock} from '../storage/draft-lock';
import {migrateLegacy} from '../storage/migrate-legacy';
import {WorkoutRepository} from '../storage/repository';

const KEY = 'ember:v1';
export function newWorkout(workout?: Workout): Workout {
  const now = new Date();
  const localTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  return {
    id: crypto.randomUUID(),
    name: workout?.name ?? 'Untitled workout',
    date: localTimestamp,
    duration: 0,
    exercises:
      workout?.exercises.map((ex) => ({
        ...ex,
        // Only the targets carry over: source evidence belongs to the recorded set, not to a
        // new session prefilled from it.
        sets: ex.sets.map(({weight, reps, seconds, distance}) => ({
          id: crypto.randomUUID(),
          weight,
          reps,
          seconds,
          distance,
          completed: false,
        })),
      })) ?? [],
  };
}
export interface AppState {
  version: 1;
  dataset: Dataset | null;
  active: Workout | null;
  finished: Workout[];
  templates: Workout[] | null;
}
const empty: AppState = {version: 1, dataset: null, active: null, finished: [], templates: []};
export function useWorkoutState() {
  const [repository] = useState(() => new WorkoutRepository());
  const [state, updateState] = useState<AppState>(empty);
  const current = useRef(state);
  const [hydrated, setHydrated] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const writable = useRef(false);
  const [ownershipError, setOwnershipError] = useState('');
  const ready = useRef(false);
  const finishing = useRef(false);
  const suspended = useRef(false);
  const [maintenance, setMaintenance] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const blocked = useRef(false);
  const generation = useRef(0);
  const lastSavedGeneration = useRef(0);
  const committed = useRef<AppState>(empty);
  const failedWrite = useRef(false);
  // Failed editor bases must survive generic retries as well as another Save click.
  const templateBases = useRef(new Map<string, Workout>());
  const writeQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const persist = useCallback(
    (next: AppState, draftOnly = false, previous?: AppState) => {
      const revision = ++generation.current;
      const bases = [...templateBases.current.values()];
      setSaveStatus('saving');
      const job = writeQueue.current.then(async () => {
        try {
          // A later draft save must also retry earlier failed document edits; otherwise
          // it could claim the whole state saved and a pull would erase those edits.
          if (draftOnly && next.active && !failedWrite.current && !bases.length)
            await repository.commitDraft(next.active);
          else
            await repository.commitState(
              next,
              failedWrite.current ? committed.current : previous,
              bases,
            );
          committed.current = next;
          failedWrite.current = false;
          for (const base of bases)
            if (templateBases.current.get(base.id) === base) templateBases.current.delete(base.id);
          if (revision === generation.current) {
            lastSavedGeneration.current = revision;
            setSaveStatus('saved');
            setError('');
          }
          return true;
        } catch {
          failedWrite.current = true;
          for (const base of bases)
            if (!templateBases.current.has(base.id)) templateBases.current.set(base.id, base);
          if (revision === generation.current) {
            setSaveStatus('error');
            setError(
              'Could not save on this device. Keep this tab open; your changes are only in memory.',
            );
          }
          return false;
        }
      });
      writeQueue.current = job;
      return job;
    },
    [repository],
  );
  useEffect(() => {
    let cancelled = false;
    let lock: DraftLock | undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        lock = await acquireDraftLock(controller.signal);
        if (cancelled) {
          lock.release();
          return;
        }
        writable.current = lock.writable;
        setReadOnly(!lock.writable);
        setOwnershipError(lock.error);
        if (lock.writable) {
          // Best-effort storage may be evicted, which empties the app until the whole history
          // downloads again. Chrome grants persistence silently to installed apps; asking only
          // when not yet persisted avoids repeat prompts in browsers that ask the user.
          void navigator.storage
            ?.persisted?.()
            .then((persisted) => persisted || navigator.storage.persist())
            .catch(() => false);
          await repository.db.transaction('rw', repository.db.meta, async () => {
            if (!(await repository.db.meta.get('installationId')))
              await repository.db.meta.add({key: 'installationId', value: crypto.randomUUID()});
          });
        }
        const result = lock.writable
          ? await migrateLegacy(repository, localStorage.getItem(KEY))
          : 'none';
        const next = await repository.readState();
        if (cancelled) return;
        if (result === 'blocked') {
          blocked.current = true;
          setRecoveryError(
            'Saved data could not be read. The original has been left untouched. Reset only after recovering it.',
          );
          setSaveStatus('error');
        } else {
          // Explicit development-only demo entry. Production and ordinary / are empty.
          if (
            lock.writable &&
            import.meta.env.DEV &&
            new URLSearchParams(location.search).get('demo') === '1' &&
            !next.active &&
            !next.dataset &&
            !next.finished.length &&
            !next.templates?.length
          ) {
            Object.assign(next, {
              dataset: demoDataset,
              templates: demoTemplates,
              active: newWorkout(demoTemplates[0]),
            });
            await repository.db.meta.put({key: 'demo-installation', value: true});
            await repository.commitState(next);
          }
          setSaveStatus('saved');
        }
        committed.current = next;
        current.current = next;
        updateState(next);
        ready.current = true;
        setHydrated(true);
      } catch {
        if (!cancelled) {
          setSaveStatus('error');
          setError(
            'Could not save on this device. Storage could not be opened; no data was changed.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      ready.current = false;
      writable.current = false;
      controller.abort();
      void writeQueue.current.then(() => repository.flush()).finally(() => lock?.release());
    };
  }, [repository]);
  const setState = useCallback(
    (action: AppState | ((state: AppState) => AppState), templateBase?: Workout) => {
      if (
        !ready.current ||
        !writable.current ||
        blocked.current ||
        suspended.current ||
        finishing.current
      )
        return Promise.resolve(false);
      const next = typeof action === 'function' ? action(current.current) : action;
      if (next === current.current) return Promise.resolve(false);
      const draftOnly =
        next.dataset === current.current.dataset &&
        next.templates === current.current.templates &&
        next.finished === current.current.finished;
      if (templateBase && !templateBases.current.has(templateBase.id))
        templateBases.current.set(templateBase.id, structuredClone(templateBase));
      const previous = current.current;
      current.current = next;
      updateState(next);
      return persist(next, draftOnly, previous);
    },
    [persist],
  );
  const finishWorkout = useCallback(async () => {
    if (
      !ready.current ||
      !writable.current ||
      blocked.current ||
      suspended.current ||
      finishing.current ||
      !current.current.active
    )
      return null;
    finishing.current = true;
    setSaveStatus('saving');
    ++generation.current;
    try {
      await writeQueue.current;
      if (failedWrite.current) {
        await repository.commitState(current.current, committed.current, [
          ...templateBases.current.values(),
        ]);
        failedWrite.current = false;
        templateBases.current.clear();
      }
      const finished = await repository.finishWorkout(current.current.active);
      const next = {
        ...current.current,
        active: null,
        finished: [finished, ...current.current.finished],
      };
      committed.current = next;
      current.current = next;
      updateState(next);
      lastSavedGeneration.current = generation.current;
      setSaveStatus('saved');
      setError('');
      return finished;
    } catch {
      setSaveStatus('error');
      setError(
        'Could not save on this device. Workout was not finished. Keep this tab open and retry.',
      );
      return null;
    } finally {
      finishing.current = false;
    }
  }, [repository]);
  /** Owner edit (`next`) or deletion (`next` null) of a finished or imported workout. */
  const changeHistoryWorkout = useCallback(
    (base: Workout, next: Workout | null) => {
      if (
        !ready.current ||
        !writable.current ||
        blocked.current ||
        suspended.current ||
        finishing.current
      )
        return Promise.resolve(false);
      const revision = ++generation.current;
      setSaveStatus('saving');
      const job = writeQueue.current.then(async () => {
        try {
          // An unsaved earlier edit must be retried first; never claim it saved here.
          if (failedWrite.current) throw new Error('Earlier changes are not saved');
          await repository.changeHistoryWorkout(base, next);
          const stored = await repository.readState();
          const history = {dataset: stored.dataset, finished: stored.finished};
          committed.current = {...committed.current, ...history};
          current.current = {...current.current, ...history};
          updateState(current.current);
          if (revision === generation.current) {
            lastSavedGeneration.current = revision;
            setSaveStatus('saved');
            setError('');
          }
          return true;
        } catch {
          // Nothing was written; the editor keeps the owner's changes and says so itself.
          if (revision === generation.current) {
            lastSavedGeneration.current = revision;
            setSaveStatus(failedWrite.current ? 'error' : 'saved');
          }
          return false;
        }
      });
      writeQueue.current = job;
      return job;
    },
    [repository],
  );
  const resetUnreadableStorage = async () => {
    if (!writable.current) return;
    if (
      !window.confirm(
        'Reset unreadable saved data? Its original bytes will remain retained for recovery.',
      )
    )
      return;
    try {
      await repository.db.meta.put({key: 'legacy-migration', value: 'explicit-reset'});
      await repository.db.importSources.put({
        key: 'unreadable-legacy',
        value: {raw: localStorage.getItem(KEY)},
      });
      blocked.current = false;
      setRecoveryError('');
      await persist(current.current);
    } catch {
      setError('Could not save on this device. Reset failed; original data is unchanged.');
    }
  };
  const refresh = useCallback(async () => {
    await writeQueue.current;
    await repository.flush();
    const revision = generation.current;
    if (lastSavedGeneration.current !== revision) return;
    const next = await repository.readState();
    if (revision === generation.current && lastSavedGeneration.current === revision) {
      current.current = {...next, active: current.current.active};
      committed.current = current.current;
      updateState(current.current);
    }
  }, [repository]);
  const pauseEditing = useCallback(
    async (requireSaved: boolean) => {
      if (
        !ready.current ||
        !writable.current ||
        suspended.current ||
        finishing.current ||
        blocked.current
      )
        throw new Error('Local state unavailable for recovery');
      suspended.current = true;
      setMaintenance(true);
      try {
        await writeQueue.current;
        await repository.flush();
        if (
          requireSaved &&
          (failedWrite.current || lastSavedGeneration.current !== generation.current)
        )
          throw new Error('Save local changes before restoring');
      } catch (error) {
        suspended.current = false;
        setMaintenance(false);
        throw error;
      }
    },
    [repository],
  );
  const resumeEditing = useCallback(() => {
    suspended.current = false;
    setMaintenance(false);
  }, []);
  const reloadState = useCallback(async () => {
    if (!suspended.current) throw new Error('Pause editing before restoring the view');
    const next = await repository.readState();
    committed.current = next;
    current.current = next;
    updateState(next);
    failedWrite.current = false;
    templateBases.current.clear();
    lastSavedGeneration.current = generation.current;
    setSaveStatus('saved');
    setError('');
  }, [repository]);
  return {
    repository,
    refresh,
    reloadState,
    pauseEditing,
    resumeEditing,
    maintenance,
    state,
    setState,
    hydrated,
    readOnly,
    ownershipError,
    saveStatus,
    finishWorkout,
    changeHistoryWorkout,
    recoveryError,
    resetUnreadableStorage,
    persistenceError: recoveryError || error,
  };
}
