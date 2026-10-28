import {liveQuery} from 'dexie';
import {useCallback, useEffect, useRef, useState} from 'react';

import type {WorkoutRepository} from '../storage/repository';
import {
  DELETES_CURSOR,
  DatasetReset,
  HISTORY_DOWNLOADED,
  type Session,
  SessionExpired,
  SyncEngine,
} from './engine';

const HISTORY_DOWNLOAD_STARTED = 'history-download-started';

export function useSync(
  repository: WorkoutRepository,
  ready: boolean,
  enabled: boolean,
  refresh: () => Promise<void>,
  locallySaved = true,
) {
  const [session, setSession] = useState<Session | null>(null);
  const current = useRef<Session | null>(null);
  const [locked, setLocked] = useState(true);
  const [status, setStatus] = useState('Connecting…');
  const [pending, setPending] = useState(0);
  const [eligibleWork, setEligibleWork] = useState('');
  const attemptedWork = useRef('');
  const [issues, setIssues] = useState<
    {operationId: string; entityId: string; errorCode?: string}[]
  >([]);
  const failures = useRef(0),
    nextAttempt = useRef(0);
  const running = useRef(false);
  const paused = useRef(false);
  const [syncing, setSyncing] = useState(false);
  // The server history has not completely arrived yet (fresh, evicted or reset installation):
  // empty screens then mean "still downloading", not "no workouts".
  const [historyIncomplete, setHistoryIncomplete] = useState(false);
  // Whether the latest sync attempt failed; steadier than the status text, which shows
  // 'Syncing…' on every retry.
  const [lastAttemptFailed, setLastAttemptFailed] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const pause = useCallback(async () => {
    paused.current = true;
    await inFlight.current;
    await repository.flush();
  }, [repository]);
  const resume = useCallback(() => {
    paused.current = false;
  }, []);
  useEffect(() => {
    if (!ready) return;
    const sub = liveQuery(async () => {
      const operations = await repository.db.outbox.toArray();
      const issues = (await repository.db.syncState.toArray())
        .filter((r) => r.key.startsWith('issue:'))
        .map((r) => r.value as {operationId: string; entityId: string; errorCode?: string});
      const blocked = new Set(issues.map((issue) => issue.entityId));
      return {
        pending: operations.length,
        eligibleWork: operations
          .filter((operation) => !blocked.has(operation.entityId))
          .map((operation) => operation.operationId)
          .sort()
          .join(','),
        owner: (await repository.db.meta.get('ownerId'))?.value,
        trust: (await repository.db.meta.get('local-trust'))?.value,
        // Only once connected to the owner's server. Installations that synced before the
        // completion flag existed already hold a cursor; an interrupted first download also
        // holds the start marker.
        historyIncomplete:
          !!(await repository.db.meta.get('ownerId'))?.value &&
          !(await repository.db.syncState.get(HISTORY_DOWNLOADED)) &&
          (!(await repository.db.syncState.get(DELETES_CURSOR)) ||
            !!(await repository.db.syncState.get(HISTORY_DOWNLOAD_STARTED))) &&
          !(await repository.db.meta.get('demo-installation'))?.value,
        issues,
      };
    }).subscribe({
      next: (state) => {
        setPending(state.pending);
        setEligibleWork(state.eligibleWork);
        setIssues(state.issues);
        setHistoryIncomplete(state.historyIncomplete);
        setLocked(!!state.owner && !state.trust);
      },
    });
    return () => sub.unsubscribe();
  }, [ready, repository]);
  // Latest-value refs read by the stable sync callback; no React Compiler is in use.
  const refreshRef = useRef(refresh);
  // eslint-disable-next-line react-hooks/refs
  refreshRef.current = refresh;
  const savedRef = useRef(locallySaved);
  // eslint-disable-next-line react-hooks/refs
  savedRef.current = locallySaved;
  const sync = useCallback(async () => {
    if (paused.current || running.current || !ready || !enabled) return;
    running.current = true;
    setSyncing(true);
    setStatus('Syncing…');
    const job = (async () => {
      try {
        await repository.flush();
        if ((await repository.db.meta.get('demo-installation'))?.value === true) {
          setStatus('Local only');
          return;
        }
        if (!savedRef.current) {
          setStatus('Not saved locally · unsaved changes are not synchronized');
          return;
        }
        if (
          (await repository.db.meta.get('ownerId'))?.value &&
          !(await repository.db.meta.get('local-trust'))?.value
        ) {
          current.current = null;
          setSession(null);
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          if (!current.current) {
            let response = await fetch('/api/v1/session', {credentials: 'same-origin'});
            if (response.status === 401)
              response = await fetch('/api/v1/session', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {'Content-Type': 'application/json'},
                body: '{}',
              });
            if (!response.ok) throw new Error('Could not connect');
            const next = (await response.json()) as Session;
            if (next.ownerId !== 'owner' || typeof next.csrfToken !== 'string' || !next.csrfToken)
              throw new Error('Invalid server session');
            if (paused.current) return;
            const owner = (await repository.db.meta.get('ownerId'))?.value;
            if (owner && owner !== next.ownerId)
              throw new Error(
                'This installation belongs to a different owner; data was not changed',
              );
            // A server reset rotates the epoch: drop synced copies before anything uploads.
            const localEpoch = (await repository.db.meta.get('dataset-epoch'))?.value ?? 'initial';
            if (typeof next.epoch === 'string' && next.epoch !== localEpoch)
              await repository.resetToEpoch(next.epoch);
            await repository.bootstrapSync();
            await repository.db.meta.put({key: 'ownerId', value: next.ownerId});
            await repository.db.meta.put({key: 'local-trust', value: true});
            current.current = next;
            setSession(next);
            setLocked(false);
          }
          if (
            (await repository.db.meta.get('ownerId'))?.value &&
            !(await repository.db.meta.get('local-trust'))?.value
          )
            return;
          if (!(await repository.db.syncState.get(DELETES_CURSOR)))
            await repository.db.syncState.put({key: HISTORY_DOWNLOAD_STARTED, value: true});
          try {
            await new SyncEngine(repository).sync(current.current);
            break;
          } catch (error) {
            if (error instanceof DatasetReset && attempt === 0) {
              await repository.resetToEpoch(error.epoch);
              continue;
            }
            if (!(error instanceof SessionExpired) || attempt === 1) throw error;
            current.current = null;
            setSession(null);
            if (paused.current || !savedRef.current) return;
          }
        }
        await refreshRef.current();
        setLastAttemptFailed(false);
        failures.current = 0;
        nextAttempt.current = 0;
        const issues = (await repository.db.syncState.toArray()).filter((r) =>
          r.key.startsWith('issue:'),
        );
        const pending = await repository.db.outbox.count();
        setStatus(
          issues.length
            ? 'Sync conflict or rejection · local changes kept for review/export'
            : pending
              ? `${pending} changes pending`
              : 'Synced',
        );
      } catch (error) {
        setLastAttemptFailed(true);
        failures.current++;
        nextAttempt.current =
          Date.now() + Math.min(60000, 1000 * 2 ** Math.min(failures.current, 6));
        if (error instanceof SessionExpired) {
          current.current = null;
          setSession(null);
          setStatus('Reconnecting · pending changes kept');
        } else setStatus('Offline or server unavailable · changes pending');
      } finally {
        running.current = false;
        setSyncing(false);
      }
    })();
    inFlight.current = job;
    await job;
  }, [repository, ready, enabled]);
  useEffect(() => {
    if (!eligibleWork) {
      attemptedWork.current = '';
      return;
    }
    if (
      !locallySaved ||
      syncing ||
      !ready ||
      !enabled ||
      eligibleWork === attemptedWork.current ||
      Date.now() < nextAttempt.current
    )
      return;
    // Completion alone must not retrigger retained/conflicted operations.
    attemptedWork.current = eligibleWork;
    void sync();
  }, [eligibleWork, locallySaved, syncing, ready, enabled, sync]);
  useEffect(() => {
    if (!ready || !enabled) return;
    void sync();
    const onWake = () => void sync();
    window.addEventListener('online', onWake);
    window.addEventListener('focus', onWake);
    const timer = setInterval(() => {
      if (Date.now() >= nextAttempt.current) void sync();
    }, 5000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [ready, enabled, sync]);
  return {
    session,
    locked,
    pending,
    issues,
    pause,
    resume,
    syncing,
    historyDownload:
      !enabled || !historyIncomplete
        ? null
        : lastAttemptFailed
          ? ('waiting' as const)
          : ('downloading' as const),
    status: !enabled
      ? 'Local only'
      : !locallySaved && status === 'Synced'
        ? 'Not saved locally · unsaved changes are not synchronized'
        : pending && status === 'Synced'
          ? `${pending} changes pending`
          : status,
    sync,
  };
}
