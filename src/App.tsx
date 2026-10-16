import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Dumbbell,
  FileUp,
  History,
  Plus,
  Settings,
  User,
  X,
} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';

import {AddExercise} from './components/AddExercise';
import {AppearanceSettings, useAppearance} from './components/AppearanceSettings';
import {BodyWeightSettings} from './components/BodyWeightSettings';
import {ElapsedTimer} from './components/ElapsedTimer';
import {ImportPanel} from './components/ImportPanel';
import {ShellUpdatePanel} from './components/ShellUpdatePanel';
import {SyncStatus} from './components/SyncStatus';
import {Button, Input, plural} from './components/ui';
import {routineTargets} from './components/workout-targets';
import {parseStrongCsv} from './domain/model';
import type {Workout} from './domain/types';
import {useBackLayer} from './state/back';
import {newWorkout, useWorkoutState} from './state/workout';
import {commitStrongImport} from './storage/import';
import {useSync} from './sync/use-sync';
import {ExerciseDetail} from './views/ExerciseDetail';
import {ExercisesView} from './views/ExercisesView';
import {HistoryView} from './views/HistoryView';
import {ProfileView} from './views/ProfileView';
import {TemplatesView} from './views/TemplatesView';
import {WorkoutView, validSet} from './views/WorkoutView';

const navigation = [
  {name: 'Profile', icon: User},
  {name: 'History', icon: History},
  {name: 'Workout', icon: Plus},
  {name: 'Exercises', icon: Dumbbell},
] as const;
type View = (typeof navigation)[number]['name'];

export default function App() {
  const appearance = useAppearance();
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  const {
    repository,
    refresh,
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
    setSetExcluded,
    changeHistoryWorkout,
    persistenceError,
    recoveryError,
    resetUnreadableStorage,
  } = useWorkoutState();
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  const sync = useSync(
    repository,
    hydrated,
    !readOnly && !recoveryError && !demo,
    refresh,
    saveStatus === 'saved',
  );
  const [view, setView] = useState<View>('Workout');
  const [exercise, setExercise] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 999px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 999px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [deletingSets, setDeletingSets] = useState(false);
  const [pendingWorkout, setPendingWorkout] = useState<Workout | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const transitioning = useRef(false);
  const pendingImport = useRef<Promise<void> | null>(null);
  // App-shell updates pause editing and sync around a saved, draft-free transition.
  const endTransition = (safeToResume = true) => {
    if (!safeToResume) return;
    transitioning.current = false;
    resumeEditing();
    sync.resume();
  };
  const beginTransition = async (requireSaved: boolean) => {
    if (transitioning.current || sync.locked || readOnly || !hydrated)
      throw new Error('Transition is locked');
    transitioning.current = true;
    try {
      const settled = await Promise.allSettled([
        sync.pause(),
        pauseEditing(requireSaved),
        pendingImport.current,
      ]);
      if (settled.some((result) => result.status === 'rejected'))
        throw new Error('Could not pause safely');
      if (
        (await repository.db.meta.get('ownerId')) &&
        !(await repository.db.meta.get('local-trust'))?.value
      )
        throw new Error('Reconnect first');
    } catch (error) {
      endTransition();
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
        if (!response.ok) throw new Error('Could not read the configured history file.');
        const parsed = parseStrongCsv(await response.text());
        if (!controller.signal.aborted && !importedManually.current)
          void setState((s) => (s.dataset ? s : {...s, dataset: parsed}));
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setNotice(error instanceof Error ? error.message : 'Could not load history.');
      });
    return () => controller.abort();
    // Keeps the existing run-once-after-hydration behavior for the configured CSV.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setState, hydrated]);
  const dataset = useMemo(
    () =>
      state.dataset ?? {
        sourceLabel: 'History',
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
  const go = (next: View) => {
    setView(next);
    setExercise(null);
    setFocusedId(null);
    setPendingWorkout(null);
    setNotice('');
  };
  const source = (id: string) => {
    go('History');
    setFocusedId(id);
    setExpanded(false);
  };
  const start = (workout: Workout) => {
    if (state.active) setPendingWorkout(workout);
    else {
      void setState((s) => ({...s, active: newWorkout(workout)}));
      setView('Workout');
      setExpanded(true);
    }
  };
  const saveTemplate = async (workout: Workout) => {
    setView('Workout');
    setNotice('Saving template…');
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
  // Back closes the newest layer; on a main tab with nothing open it leaves the app as before.
  // The expanded workout counts only on mobile, where it covers the tabs.
  useBackLayer(showSheet && mobile, () => setExpanded(false));
  useBackLayer(view === 'Exercises' && !!exercise, () => setExercise(null));
  useBackLayer(settingsOpen, () => setSettingsOpen(false));
  useBackLayer(!!pendingWorkout && !sync.locked, () => setPendingWorkout(null));
  useBackLayer(confirmCancel && !sync.locked, () => setConfirmCancel(false));
  useBackLayer(confirmFinish && !sync.locked, () => setConfirmFinish(false));
  const feedback = notice && (
    <div className='notice' role='status'>
      {notice}
      <Button variant='ghost' size='icon' aria-label='Dismiss notice' onClick={() => setNotice('')}>
        <X size={15} />
      </Button>
    </div>
  );
  // Sync is silent. Only states that need the owner surface here.
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
        <section aria-label='Sync problems' className='error-banner'>
          <p>
            {plural(sync.issues.length, 'change')} could not sync. Later edits to the same item wait
            until this is resolved.
          </p>
          <ul>
            {sync.issues.map((issue) => (
              <li key={issue.operationId}>
                <strong>{issue.errorCode ?? 'SYNC_REJECTED'}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
  const settingsButton = (
    <Button
      variant='ghost'
      size='icon'
      aria-label='Settings'
      aria-expanded={settingsOpen}
      onClick={(event) => {
        settingsTrigger.current = event.currentTarget;
        setSettingsOpen((value) => !value);
      }}
    >
      <Settings size={20} />
    </Button>
  );
  const title = view === 'Exercises' && exercise ? 'Exercise' : view;
  return (
    <div
      className={`app-shell ${showSheet ? 'sheet-open' : ''}`}
      data-save={saveStatus}
      data-sync={sync.status}
    >
      {sync.locked && (
        <div className='locked-status'>
          {!settingsOpen && (
            <>
              <SyncStatus sync={sync} />
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
          <header className='app-bar'>
            <span className='app-brand'>Gym Log</span>
            <nav aria-label='Main navigation'>
              {navigation.map(({name, icon: Icon}) => (
                <button
                  key={name}
                  className={`nav-item ${view === name ? 'active' : ''}`}
                  aria-current={view === name ? 'page' : undefined}
                  onClick={() => go(name)}
                >
                  <Icon size={22} />
                  <span>{name}</span>
                </button>
              ))}
            </nav>
            <div className='app-bar-actions'>{settingsButton}</div>
          </header>
          <div className='library-scroll'>
            <h1 className='page-title'>{title}</h1>
            {!showSheet && !sync.locked && !settingsOpen && errors}
            <fieldset disabled={disabled} className='content-fieldset'>
              {!showSheet && !settingsOpen && feedback}
              {view === 'Workout' && !sync.locked && (
                <>
                  <section className='quick-start' aria-labelledby='quick-start'>
                    <h2 className='list-label' id='quick-start'>
                      Quick start
                    </h2>
                    <Button
                      variant='primary'
                      className='wide-action'
                      onClick={() => start(newWorkout())}
                    >
                      Start empty workout
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
                  dataset={allDataset}
                  focusedId={focusedId}
                  onRepeat={start}
                  onTemplate={saveTemplate}
                  onExclude={setSetExcluded}
                  onChange={changeHistoryWorkout}
                  disabled={disabled}
                  locked={sync.locked}
                />
              )}
              {view === 'Exercises' &&
                (exercise ? (
                  <ExerciseDetail
                    key={exercise}
                    dataset={allDataset}
                    name={exercise}
                    onBack={() => setExercise(null)}
                    onSource={source}
                    onExclude={setSetExcluded}
                  />
                ) : (
                  <ExercisesView dataset={allDataset} onOpen={setExercise} />
                ))}
              {view === 'Profile' && (
                <ProfileView workouts={allDataset.workouts} onExclude={setSetExcluded} />
              )}
            </fieldset>
            {/* Outside the fieldset: phones reach Settings only here, also while edits are disabled. */}
            {view === 'Profile' && !sync.locked && (
              <nav className='profile-links' aria-label='Profile'>
                <Button
                  variant='ghost'
                  className='profile-link'
                  onClick={(event) => {
                    settingsTrigger.current = event.currentTarget;
                    setSettingsOpen(true);
                  }}
                >
                  <Settings size={18} /> Settings <ChevronRight size={16} />
                </Button>
              </nav>
            )}
          </div>
          {state.active && !showSheet && (
            <Button
              className='resume-bar'
              variant='secondary'
              aria-label={`Resume ${state.active.name}`}
              onClick={() => setExpanded(true)}
            >
              <ChevronUp size={20} />
              <div>
                <strong>{state.active.name}</strong>
                <span>
                  <ElapsedTimer start={state.active.date} /> · {completed} / {sets.length} sets
                </span>
              </div>
            </Button>
          )}
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
                  {settingsButton}
                  {showSheet && <ElapsedTimer start={state.active.date} />}
                  <Button
                    variant='primary'
                    className='finish-button'
                    aria-label='Finish workout'
                    disabled={disabled || deletingSets || !completed}
                    onClick={() => setConfirmFinish(true)}
                  >
                    Finish
                  </Button>
                </div>
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
                {showSheet && (
                  <div className='workout-meta'>
                    <span>
                      <strong>
                        {completed} / {sets.length}
                      </strong>{' '}
                      {sets.length === 1 ? 'set' : 'sets'} completed
                    </span>
                  </div>
                )}
              </header>
              <div className='workout-scroll'>
                <h2 className='sr-only'>Your workout</h2>
                {showSheet && !settingsOpen && (
                  <>
                    {errors}
                    {feedback}
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
                    onExclude={setSetExcluded}
                    disabled={disabled}
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
                    <Button
                      variant='secondary'
                      className='wide-action cancel-workout'
                      onClick={() => setConfirmCancel(true)}
                    >
                      Cancel workout
                    </Button>
                  </div>
                </fieldset>
              </div>
            </div>
          </section>
        )}
      </main>
      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
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
              Appearance, body weight, Strong import and app updates.
            </Dialog.Description>
            {errors}
            {feedback}
            <AppearanceSettings settings={appearance} />
            {/* Personal history: unmounted while sync is locked, like other owned data. */}
            {hydrated && !sync.locked && !recoveryError && (
              <BodyWeightSettings repository={repository} disabled={disabled} />
            )}
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
                    if (transitioning.current) throw new Error('Update in progress');
                    const job = (async () => {
                      importedManually.current = true;
                      const result = await commitStrongImport(repository, prepared, true);
                      await refresh();
                      setNotice(
                        (result.status === 'identical'
                          ? 'Identical file already imported. No history changed.'
                          : 'History replaced. Your draft and finished workouts were kept.') +
                          (result.unmatchedExclusions
                            ? ` ${plural(result.unmatchedExclusions, 'excluded set')} no longer in this export, so ${result.unmatchedExclusions === 1 ? 'its' : 'their'} exclusion was dropped.`
                            : ''),
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
            {!demo && (
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
                begin={beginTransition}
                end={endTransition}
              />
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
              Your current workout will be discarded. All repeated sets start uncompleted.
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
      <Dialog.Root open={confirmCancel && !sync.locked} onOpenChange={setConfirmCancel}>
        <Dialog.Portal>
          <Dialog.Overlay className='dialog-overlay' />
          <Dialog.Content className='dialog-content'>
            <Dialog.Title>Cancel this workout?</Dialog.Title>
            <Dialog.Description>
              {plural(sets.length, 'set')} will be discarded. Finished workouts are not affected.
            </Dialog.Description>
            <div className='dialog-actions'>
              <Dialog.Close asChild>
                <Button>Keep logging</Button>
              </Dialog.Close>
              <Button
                variant='danger'
                disabled={disabled || deletingSets}
                onClick={async () => {
                  if (await setState((s) => ({...s, active: null}))) setConfirmCancel(false);
                }}
              >
                Discard workout
              </Button>
            </div>
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
