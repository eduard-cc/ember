import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  FileUp,
  History,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';

import {AddExercise} from './components/AddExercise';
import {AppearanceSettings, useAppearance} from './components/AppearanceSettings';
import {ImportPanel} from './components/ImportPanel';
import {RecoveryPanel} from './components/RecoveryPanel';
import {ShellUpdatePanel} from './components/ShellUpdatePanel';
import {SyncStatus} from './components/SyncStatus';
import {Button, Input, plural} from './components/ui';
import {routineTargets} from './components/workout-targets';
import {parseStrongCsv} from './domain/model';
import type {Workout} from './domain/types';
import {newWorkout, useWorkoutState} from './state/workout';
import {commitStrongImport} from './storage/import';
import {useSync} from './sync/use-sync';
import {HistoryView} from './views/HistoryView';
import {ProgressView} from './views/ProgressView';
import {TemplatesView} from './views/TemplatesView';
import {WorkoutView, validSet} from './views/WorkoutView';

const navigation = [
  {name: 'Workouts', icon: Dumbbell},
  {name: 'History', icon: History},
  {name: 'Exercises', icon: Activity},
] as const;
export default function App() {
  const appearance = useAppearance();
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  const {
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
    persistenceError,
    recoveryError,
    resetUnreadableStorage,
  } = useWorkoutState();
  const sync = useSync(
    repository,
    hydrated,
    !readOnly && !recoveryError && new URLSearchParams(location.search).get('demo') !== '1',
    refresh,
    saveStatus === 'saved',
  );
  const [view, setView] = useState<string>('Workouts');
  const [expanded, setExpanded] = useState(true);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 999px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 999px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [deletingSets, setDeletingSets] = useState(false);
  const [pendingWorkout, setPendingWorkout] = useState<Workout | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const transitioning = useRef(false);
  const pendingImport = useRef<Promise<void> | null>(null);
  const endRecovery = (safeToResume = true) => {
    if (!safeToResume) return;
    transitioning.current = false;
    resumeEditing();
    sync.resume();
  };
  const beginRecovery = async (restoring: boolean) => {
    if (transitioning.current || sync.locked || readOnly || !hydrated)
      throw new Error('Recovery is locked');
    transitioning.current = true;
    try {
      const settled = await Promise.allSettled([
        sync.pause(),
        pauseEditing(restoring),
        pendingImport.current,
      ]);
      if (settled.some((result) => result.status === 'rejected'))
        throw new Error('Could not pause safely');
      if (
        (await repository.db.meta.get('ownerId')) &&
        !(await repository.db.meta.get('local-trust'))?.value
      )
        throw new Error('Reconnect before recovery');
    } catch (error) {
      endRecovery();
      throw error;
    }
  };
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let frame = 0;
    const revealField = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const field = document.activeElement;
        if (!(field instanceof HTMLInputElement) || !window.matchMedia('(max-width:999px)').matches)
          return;
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop ?? 0,
          bottom = top + (viewport?.height ?? window.innerHeight);
        const rect = field.getBoundingClientRect();
        const scroller = field.closest(
          '.workout-scroll, .settings-panel, .library-scroll, .dialog-content',
        );
        const bounds = scroller?.getBoundingClientRect();
        const visibleTop = Math.max(top, bounds?.top ?? top);
        const visibleBottom = Math.min(bottom, bounds?.bottom ?? bottom);
        if (rect.bottom > visibleBottom - 14)
          scroller?.scrollBy(0, rect.bottom - visibleBottom + 14);
        else if (rect.top < visibleTop + 14) scroller?.scrollBy(0, rect.top - visibleTop - 14);
      });
    };
    document.addEventListener('focusin', revealField);
    window.addEventListener('resize', revealField);
    window.visualViewport?.addEventListener('resize', revealField);
    window.visualViewport?.addEventListener('scroll', revealField);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', revealField);
      window.removeEventListener('resize', revealField);
      window.visualViewport?.removeEventListener('resize', revealField);
      window.visualViewport?.removeEventListener('scroll', revealField);
    };
  }, []);
  const importedManually = useRef(false);
  useEffect(() => {
    if (
      !hydrated ||
      state.dataset ||
      !import.meta.env.DEV ||
      new URLSearchParams(location.search).get('localCsv') !== '1'
    )
      return;
    const controller = new AbortController();
    fetch('/__local/strong.csv', {signal: controller.signal})
      .then(async (response) => {
        if (response.status === 404) return;
        if (!response.ok)
          throw new Error('Could not read configured local history. Demo data remains available.');
        const parsed = parseStrongCsv(await response.text());
        if (!controller.signal.aborted && !importedManually.current)
          void setState((s) => (s.dataset ? s : {...s, dataset: parsed}));
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setNotice(error instanceof Error ? error.message : 'Could not load local history.');
      });
    return () => controller.abort();
    // Keeps the existing run-once-after-hydration behavior for the configured CSV.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setState, hydrated]);
  const dataset = useMemo(
    () =>
      state.dataset ?? {
        sourceLabel: 'Local data',
        workouts: [],
        warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
      },
    [state.dataset],
  );
  const templates = state.templates ?? [];
  // Stable across keystrokes so per-row history lookups can memoize on it.
  const allDataset = useMemo(
    () => ({
      ...dataset,
      workouts: [...state.finished, ...dataset.workouts].sort((a, b) =>
        b.date.localeCompare(a.date),
      ),
    }),
    [dataset, state.finished],
  );
  const source = (id: string) => {
    setFocusedId(id);
    setExpanded(false);
    setView('History');
  };
  const start = (workout: Workout) => {
    if (state.active) setPendingWorkout(workout);
    else {
      void setState((s) => ({...s, active: newWorkout(workout)}));
      setView('Workouts');
      setExpanded(true);
    }
  };
  const saveTemplate = async (workout: Workout) => {
    setView('Workouts');
    setNotice('Saving template on this device…');
    const saved = await setState((s) => ({
      ...s,
      templates: [...(s.templates ?? []), newWorkout(workout)],
    }));
    setNotice(
      saved
        ? 'Workout saved as an editable template.'
        : 'Template was not saved. Keep this tab open and retry.',
    );
  };
  const sets = state.active?.exercises.flatMap((ex) => ex.sets) ?? [];
  const completed =
    state.active?.exercises.reduce(
      (n, ex) => n + ex.sets.filter((set) => set.completed && validSet(set, ex.type)).length,
      0,
    ) ?? 0;
  const finish = async () => {
    if (!completed || deletingSets) return;
    const workout = await finishWorkout();
    if (workout) {
      setConfirmFinish(false);
      setFocusedId(workout.id);
      setView('History');
    }
  };
  const disabled = !hydrated || readOnly || sync.locked || maintenance || !!recoveryError;
  const showSheet = !!state.active && expanded && !sync.locked;
  const savedLabel =
    saveStatus === 'loading'
      ? 'Loading…'
      : saveStatus === 'saving'
        ? 'Saving…'
        : saveStatus === 'error'
          ? 'Not saved'
          : 'Saved on this device';
  const feedback = notice && (
    <div className='notice' role='status'>
      {notice}
      <Button variant='ghost' size='icon' aria-label='Dismiss notice' onClick={() => setNotice('')}>
        <X size={15} />
      </Button>
    </div>
  );
  const errors = (
    <>
      {ownershipError && (
        <div className='error-banner' role='alert'>
          {ownershipError}
          <Button onClick={() => location.reload()}>Reload to enable editing</Button>
        </div>
      )}
      {persistenceError && (
        <div className='error-banner' role='alert'>
          {persistenceError}
          {recoveryError && (
            <Button variant='danger' onClick={resetUnreadableStorage}>
              Reset unreadable saved data
            </Button>
          )}
        </div>
      )}
      {!sync.locked && sync.issues.length > 0 && (
        <section aria-label='Retained sync problems' className='error-banner'>
          <p>
            Sync problems need review. Local changes are retained; export before manual recovery.
          </p>
          <ul>
            {sync.issues.map((issue) => (
              <li key={issue.operationId}>
                <strong>{issue.errorCode ?? 'SYNC_REJECTED'}</strong>
                <p>
                  Record {issue.entityId}. Operation {issue.operationId} is retained locally; later
                  edits to this record are paused.
                </p>
              </li>
            ))}
          </ul>
          <Button onClick={() => setRecoveryOpen(true)}>Recovery settings</Button>
        </section>
      )}
    </>
  );
  const settingsButton = (
    <Button
      variant='ghost'
      size='icon'
      aria-label='Settings'
      aria-expanded={recoveryOpen}
      onClick={(event) => {
        settingsTrigger.current = event.currentTarget;
        setRecoveryOpen((value) => !value);
      }}
    >
      <Settings size={20} />
    </Button>
  );
  const syncStatus = new URLSearchParams(location.search).get('demo') !== '1' && (
    <SyncStatus sync={sync} />
  );
  return (
    <div className={`app-shell ${showSheet ? 'sheet-open' : ''}`}>
      {sync.locked && (
        <div className='locked-status'>
          {!recoveryOpen && (
            <>
              {syncStatus}
              {errors}
            </>
          )}
          {settingsButton}
        </div>
      )}
      <main hidden={sync.locked} className='workspace'>
        <div
          className='library'
          inert={showSheet && mobile}
          aria-hidden={showSheet && mobile ? true : undefined}
        >
          <header className='topbar'>
            <a
              className='brand'
              href='#'
              onClick={(e) => {
                e.preventDefault();
                setView('Workouts');
              }}
            >
              <Dumbbell size={24} /> Gym Log
            </a>
            <div className='topbar-actions'>{settingsButton}</div>
          </header>
          <div className='library-scroll'>
            {!showSheet && !sync.locked && !recoveryOpen && errors}
            {!showSheet && !sync.locked && (
              <div className='library-status'>
                <span className='source-badge'>{dataset.sourceLabel}</span>
                <span className='saved-status' role='status'>
                  {savedLabel}
                </span>
                {!recoveryOpen && syncStatus}
              </div>
            )}
            <fieldset disabled={disabled} className='content-fieldset'>
              <div className='page-heading'>
                <div>
                  <h1>
                    {view === 'History'
                      ? 'Workout history'
                      : view === 'Exercises'
                        ? 'Exercise progress'
                        : 'Workouts'}
                  </h1>
                  <p>
                    {view === 'History'
                      ? 'Review the work. Repeat what works.'
                      : view === 'Exercises'
                        ? 'Real sets, clear trends. Always traceable to your training.'
                        : 'Your routines, ready when you are.'}
                  </p>
                </div>
              </div>
              {!showSheet && !recoveryOpen && feedback}
              {view === 'Workouts' && (
                <>
                  <section className='start-workout'>
                    <div>
                      <h2>{state.active ? 'Start a workout' : 'Ready for your next workout'}</h2>
                      <p>Choose a routine, repeat history, or start with a clean slate.</p>
                    </div>
                    <Button onClick={() => start(newWorkout())}>
                      {' '}
                      <Plus size={16} /> Start empty workout
                    </Button>
                  </section>
                  <TemplatesView
                    templates={templates}
                    dataset={allDataset}
                    onChange={(templates, base) => setState((s) => ({...s, templates}), base)}
                    onStart={(workout) => start(routineTargets(workout, allDataset))}
                  />
                </>
              )}
              {view === 'History' && (
                <HistoryView
                  workouts={allDataset.workouts}
                  focusedId={focusedId}
                  onRepeat={start}
                  onTemplate={saveTemplate}
                />
              )}
              {view === 'Exercises' && <ProgressView dataset={allDataset} onSource={source} />}
              <footer className='page-foot'>
                Local-first logging · drafts are device-local · server sync is not off-device backup
              </footer>
            </fieldset>
          </div>
          {state.active && !showSheet && (
            <Button
              className='resume-bar'
              variant='primary'
              aria-label={`Resume ${state.active.name}`}
              onClick={() => setExpanded(true)}
            >
              <div>
                <strong>{state.active.name}</strong>
                <span>
                  {completed} / {plural(sets.length, 'set')} completed · Resume workout
                </span>
              </div>
              <ChevronUp size={20} />
            </Button>
          )}
          <nav aria-label='Main navigation'>
            {navigation.map(({name, icon: Icon}) => (
              <button
                key={name}
                className={`nav-item ${view === name ? 'active' : ''}`}
                aria-current={view === name ? 'page' : undefined}
                onClick={() => {
                  setView(name);
                  setFocusedId(null);
                  setPendingWorkout(null);
                  setNotice('');
                }}
              >
                <Icon size={22} />
                <span>{name}</span>
              </button>
            ))}
          </nav>
        </div>
        {/* Unmounted while locked: portaled dialogs (Previous evidence) escape <main hidden>. */}
        {state.active && !sync.locked && (
          <section className='workout-sheet' aria-label='Active workout' hidden={!showSheet}>
            <div className='workout-fieldset'>
              <header className='workout-top'>
                <div className='title-row'>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label='Minimize workout'
                    onClick={() => setExpanded(false)}
                  >
                    <ChevronDown size={22} />
                  </Button>
                  <label className='sr-only' htmlFor='workout-name'>
                    WORKOUT NAME
                  </label>
                  <Input
                    disabled={disabled}
                    id='workout-name'
                    className='workout-title'
                    value={state.active.name}
                    onChange={(event) =>
                      setState((s) =>
                        s.active ? {...s, active: {...s.active, name: event.target.value}} : s,
                      )
                    }
                  />
                  <Button
                    variant='primary'
                    aria-label='Finish workout'
                    disabled={disabled || deletingSets || !completed}
                    onClick={() => setConfirmFinish(true)}
                  >
                    Finish
                  </Button>
                </div>
                {showSheet && (
                  <div className='workout-meta'>
                    <span>
                      <strong>
                        {completed} / {sets.length}
                      </strong>{' '}
                      {sets.length === 1 ? 'set' : 'sets'} completed
                    </span>
                    <span className='saved-status' role='status'>
                      {savedLabel}
                    </span>
                  </div>
                )}
              </header>
              <div className='workout-scroll'>
                <h1 className='sr-only'>Your workout</h1>
                {showSheet && (
                  <>
                    {!recoveryOpen && (
                      <>
                        {errors}
                        {feedback}
                      </>
                    )}
                    <div className='logger-status'>
                      {!recoveryOpen && syncStatus}
                      {settingsButton}
                    </div>
                  </>
                )}
                <fieldset disabled={disabled} className='content-fieldset'>
                  <WorkoutView
                    key={state.active.id}
                    workout={state.active}
                    dataset={allDataset}
                    onChange={(update) =>
                      setState((s) =>
                        s.active
                          ? {...s, active: typeof update === 'function' ? update(s.active) : update}
                          : s,
                      )
                    }
                    onDeletingChange={setDeletingSets}
                    onSource={source}
                  />
                  <div className='logger-tools'>
                    <AddExercise
                      dataset={allDataset}
                      onAdd={(exercise) =>
                        setState((s) =>
                          s.active
                            ? {
                                ...s,
                                active: {...s.active, exercises: [...s.active.exercises, exercise]},
                              }
                            : s,
                        )
                      }
                    />
                    <div className='logger-footer'>
                      <Button
                        onClick={() => {
                          setView('Workouts');
                          setExpanded(false);
                        }}
                      >
                        Choose a routine
                      </Button>
                      <Button variant='ghost' onClick={() => start(newWorkout())}>
                        Start empty
                      </Button>
                    </div>
                    <p className='draft-note'>
                      {persistenceError
                        ? 'Draft is only in memory. Browser storage could not be updated.'
                        : 'Your draft stays on this device. Server sync is not off-device backup.'}
                    </p>
                  </div>
                </fieldset>
              </div>
            </div>
          </section>
        )}
      </main>
      <Dialog.Root open={recoveryOpen} onOpenChange={setRecoveryOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className='dialog-overlay' />
          <Dialog.Content
            className='dialog-content settings-panel'
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              settingsTrigger.current?.focus();
            }}
          >
            <div className='section-heading'>
              <Dialog.Title>Settings</Dialog.Title>
              <Dialog.Close asChild>
                <Button aria-label='Close settings' variant='ghost' size='icon'>
                  <X size={20} />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className='sr-only'>
              Appearance, import, synchronization, recovery and app updates.
            </Dialog.Description>
            {errors}
            {feedback}
            <AppearanceSettings settings={appearance} />
            <Button
              aria-label='Import CSV'
              disabled={disabled}
              onClick={() => setImportOpen((value) => !value)}
            >
              <FileUp size={17} />
              Import CSV
            </Button>
            {importOpen && (
              <fieldset disabled={disabled} className='content-fieldset'>
                <ImportPanel
                  onClose={() => setImportOpen(false)}
                  onReplace={async (prepared) => {
                    if (transitioning.current) throw new Error('Recovery in progress');
                    const job = (async () => {
                      importedManually.current = true;
                      const result = await commitStrongImport(repository, prepared, true);
                      await refresh();
                      setNotice(
                        result === 'identical'
                          ? 'Identical file already imported. No history changed.'
                          : 'History replaced. Your draft and finished workouts were kept.',
                      );
                      void sync.sync();
                    })();
                    pendingImport.current = job;
                    try {
                      await job;
                    } finally {
                      if (pendingImport.current === job) pendingImport.current = null;
                    }
                  }}
                />
              </fieldset>
            )}
            {new URLSearchParams(location.search).get('demo') !== '1' && (
              <>
                <section aria-label='Sync settings' className='notice'>
                  <div>
                    <h3>Synchronization</h3>
                    <p>
                      Completed history and templates sync automatically. Active drafts stay on this
                      device.
                    </p>
                    <p>Server sync is not off-device disaster backup.</p>
                    {syncStatus}
                    <Button disabled={maintenance || sync.syncing} onClick={() => void sync.sync()}>
                      Sync now
                    </Button>
                  </div>
                </section>
                <RecoveryPanel
                  repository={repository}
                  readOnly={disabled}
                  persistenceError={!!persistenceError}
                  begin={beginRecovery}
                  end={endRecovery}
                  onRestored={async () => {
                    await reloadState();
                    setImportOpen(false);
                    setPendingWorkout(null);
                    setConfirmFinish(false);
                    setView('Workouts');
                    setExpanded(true);
                  }}
                />
                <ShellUpdatePanel
                  repository={repository}
                  available={
                    hydrated &&
                    !readOnly &&
                    !sync.locked &&
                    !maintenance &&
                    !sync.syncing &&
                    saveStatus === 'saved' &&
                    !state.active &&
                    !recoveryError
                  }
                  begin={beginRecovery}
                  end={endRecovery}
                />
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={!!pendingWorkout && !sync.locked}
        onOpenChange={(open) => {
          if (!open) setPendingWorkout(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className='dialog-overlay' />
          <Dialog.Content className='dialog-content'>
            <Dialog.Title>Replace your active workout?</Dialog.Title>
            <Dialog.Description>
              Your current draft will be discarded. All repeated sets start uncompleted.
            </Dialog.Description>
            <div className='dialog-actions'>
              <Button
                onClick={() => {
                  setPendingWorkout(null);
                  setExpanded(true);
                }}
              >
                Resume current workout
              </Button>
              <Button
                variant='primary'
                disabled={disabled}
                onClick={() => {
                  if (!pendingWorkout) return;
                  void setState((s) => ({...s, active: newWorkout(pendingWorkout)}));
                  setPendingWorkout(null);
                  setExpanded(true);
                }}
              >
                Replace active draft
              </Button>
            </div>
            <Dialog.Close asChild>
              <Button
                variant='ghost'
                size='icon'
                className='dialog-close'
                aria-label='Cancel replacement'
              >
                <X size={18} />
              </Button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={confirmFinish && !sync.locked} onOpenChange={setConfirmFinish}>
        <Dialog.Portal>
          <Dialog.Overlay className='dialog-overlay' />
          <Dialog.Content className='dialog-content'>
            <Dialog.Title>Finish this workout?</Dialog.Title>
            {persistenceError && <p role='alert'>{persistenceError}</p>}
            <Dialog.Description>
              {completed} completed set{completed !== 1 ? 's' : ''} will be saved.{' '}
              {sets.length - completed} uncompleted sets will be excluded.
            </Dialog.Description>
            <p className='quiet-note'>
              Saved on this device only. You can repeat this workout from History.
            </p>
            <div className='dialog-actions'>
              <Dialog.Close asChild>
                <Button>Keep logging</Button>
              </Dialog.Close>
              <Button
                variant='primary'
                disabled={disabled || deletingSets || !completed}
                onClick={finish}
              >
                Save finished workout
              </Button>
            </div>
            <Dialog.Close asChild>
              <Button variant='ghost' size='icon' className='dialog-close' aria-label='Close'>
                <X size={18} />
              </Button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
