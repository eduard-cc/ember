import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
  ArrowUpRight,
  Check,
  ClipboardList,
  Dumbbell,
  FileUp,
  History,
  Layers,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {AddExercise} from './components/AddExercise';
import {ImportPanel} from './components/ImportPanel';
import {RecoveryPanel} from './components/RecoveryPanel';
import {ShellUpdatePanel} from './components/ShellUpdatePanel';
import {SyncStatus} from './components/SyncStatus';
import {Button, Input} from './components/ui';
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
  {name: 'Workout', icon: Dumbbell},
  {name: 'Progress', icon: Activity},
  {name: 'History', icon: History},
  {name: 'Templates', icon: Layers},
] as const;
export default function App() {
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
  const [view, setView] = useState<string>('Workout');
  const [confirmFinish, setConfirmFinish] = useState(false);
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
        if (
          !(field instanceof HTMLInputElement) ||
          !window.matchMedia('(max-width:600px), (max-width:900px) and (max-height:500px)').matches
        )
          return;
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop ?? 0,
          bottom = top + (viewport?.height ?? window.innerHeight);
        const rect = field.getBoundingClientRect();
        if (rect.bottom > bottom - 12) window.scrollBy(0, rect.bottom - bottom + 12);
        else if (rect.top < top + 12) window.scrollBy(0, rect.top - top - 12);
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
          setState((s) => (s.dataset ? s : {...s, dataset: parsed}));
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setNotice(error instanceof Error ? error.message : 'Could not load local history.');
      });
    return () => controller.abort();
  }, [setState, hydrated]);
  const dataset = state.dataset ?? {
    sourceLabel: 'Local data',
    workouts: [],
    warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
  };
  const templates = state.templates ?? [];
  const allDataset = {
    ...dataset,
    workouts: [...state.finished, ...dataset.workouts].sort((a, b) => b.date.localeCompare(a.date)),
  };
  const source = (id: string) => {
    setFocusedId(id);
    setView('History');
  };
  const start = (workout: Workout) => {
    if (state.active) setPendingWorkout(workout);
    else {
      setState((s) => ({...s, active: newWorkout(workout)}));
      setView('Workout');
    }
  };
  const saveTemplate = async (workout: Workout) => {
    setView('Templates');
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
    if (!completed) return;
    const workout = await finishWorkout();
    if (workout) {
      setConfirmFinish(false);
      setFocusedId(workout.id);
      setView('History');
    }
  };
  return (
    <div className='app-shell'>
      <aside className='sidebar'>
        <a
          className='brand'
          href='#'
          onClick={(e) => {
            e.preventDefault();
            setView('Workout');
          }}
        >
          <span className='brand-mark'>
            <Dumbbell size={21} />
          </span>
          gym log<span className='brand-dot'>.</span>
        </a>
        <span className='nav-label'>YOUR TRAINING</span>
        <nav aria-label='Main navigation'>
          {navigation.map(({name, icon: Icon}) => (
            <button
              key={name}
              className={view === name ? 'nav-item active' : 'nav-item'}
              aria-current={view === name ? 'page' : undefined}
              onClick={() => {
                setView(name);
                setFocusedId(null);
                setPendingWorkout(null);
                setNotice('');
              }}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === 'Workout' && !sync.locked && state.active && (
                <span className='active-dot' />
              )}
            </button>
          ))}
        </nav>
        <div className='sidebar-foot'>
          <ShieldCheck size={18} />
          <div>
            <strong>Local by design</strong>
            <p>Your training stays here.</p>
          </div>
        </div>
      </aside>
      <div className='workspace'>
        <header className='topbar'>
          <span className='breadcrumb'>
            Training <span>/</span> <strong>{view}</strong>
          </span>
          <span className='source-badge'>{sync.locked ? 'Local data' : dataset.sourceLabel}</span>
          <span className='saved-status'>
            <Check size={14} />
            {saveStatus === 'loading'
              ? 'Loading…'
              : saveStatus === 'saving'
                ? 'Saving…'
                : saveStatus === 'error'
                  ? 'Not saved'
                  : 'Saved on this device'}
          </span>
          <Button
            variant='ghost'
            size='icon'
            aria-label='Import CSV'
            disabled={!hydrated || readOnly || sync.locked || maintenance || !!recoveryError}
            onClick={() => setImportOpen((value) => !value)}
          >
            <FileUp size={17} />
          </Button>
          {new URLSearchParams(location.search).get('demo') !== '1' && (
            <Button
              variant='ghost'
              aria-label='Recovery settings'
              aria-expanded={recoveryOpen}
              disabled={maintenance}
              onClick={() => setRecoveryOpen((value) => !value)}
            >
              Recovery
            </Button>
          )}
          {new URLSearchParams(location.search).get('demo') !== '1' && <SyncStatus sync={sync} />}
        </header>
        {recoveryOpen && (
          <section aria-label='Sync settings' className='notice'>
            <div>
              <p>
                Completed history and templates sync automatically. Active drafts stay on this
                device.
              </p>
              <p className='quiet-note'>Server sync is not off-device disaster backup.</p>
              <Button disabled={maintenance || sync.syncing} onClick={() => void sync.sync()}>
                Sync now
              </Button>
            </div>
          </section>
        )}
        {!sync.locked && sync.issues.length > 0 && (
          <section aria-label='Retained sync problems' className='error-banner'>
            <div>
              <p>
                Sync problems need review. Local changes are retained; export before manual
                recovery.
              </p>
              <ul>
                {sync.issues.map((issue) => (
                  <li key={issue.operationId}>
                    <strong>{issue.errorCode ?? 'SYNC_REJECTED'}</strong>
                    <p>
                      Record {issue.entityId}. Operation {issue.operationId} is retained locally;
                      later edits to this record are paused.
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
        {recoveryOpen && (
          <RecoveryPanel
            repository={repository}
            readOnly={!hydrated || readOnly || sync.locked || maintenance || !!recoveryError}
            persistenceError={!!persistenceError}
            begin={beginRecovery}
            end={endRecovery}
            onRestored={async () => {
              await reloadState();
              setImportOpen(false);
              setPendingWorkout(null);
              setConfirmFinish(false);
              setView('Workout');
            }}
          />
        )}
        {recoveryOpen && (
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
        )}
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
        <main hidden={sync.locked}>
          <fieldset
            disabled={!hydrated || readOnly || sync.locked || maintenance || !!recoveryError}
            style={{display: 'contents'}}
          >
            {importOpen && (
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
            )}
            <div
              className={`page-heading ${view === 'Workout' && state.active ? 'active-workout-heading' : ''}`}
            >
              <div>
                <span className='eyebrow'>
                  {view === 'Workout' ? 'ONE SET AT A TIME' : 'YOUR TRAINING LOG'}
                </span>
                <h1>
                  {view === 'Workout'
                    ? 'Your workout'
                    : view === 'History'
                      ? 'Workout history'
                      : view === 'Progress'
                        ? 'Exercise progress'
                        : 'Your templates'}
                </h1>
                <p>
                  {view === 'Workout'
                    ? 'Adjust your targets. Confirm each set when it’s done.'
                    : view === 'Progress'
                      ? 'Real sets, clear trends. Always traceable to your training.'
                      : view === 'Templates'
                        ? 'A starting point for the way you train.'
                        : 'Review the work. Repeat what works.'}
                </p>
                {view === 'Workout' && state.active && (
                  <div className='workout-name'>
                    <label htmlFor='workout-name'>WORKOUT NAME</label>
                    <Input
                      id='workout-name'
                      value={state.active.name}
                      onChange={(event) =>
                        setState((s) =>
                          s.active ? {...s, active: {...s.active, name: event.target.value}} : s,
                        )
                      }
                    />
                  </div>
                )}
              </div>
              {view === 'Workout' && state.active && (
                <Button
                  variant='primary'
                  disabled={!completed}
                  onClick={() => setConfirmFinish(true)}
                >
                  Finish workout <ArrowUpRight size={16} />
                </Button>
              )}
            </div>
            {notice && (
              <div className='notice' role='status'>
                {notice}
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label='Dismiss notice'
                  onClick={() => setNotice('')}
                >
                  <X size={15} />
                </Button>
              </div>
            )}
            {pendingWorkout && (
              <div className='replace-draft' role='alert'>
                <div>
                  <strong>Replace your active workout?</strong>
                  <p>Your current draft will be discarded. All repeated sets start uncompleted.</p>
                </div>
                <Button onClick={() => setPendingWorkout(null)}>Cancel</Button>
                <Button
                  variant='primary'
                  onClick={() => {
                    setState((s) => ({...s, active: newWorkout(pendingWorkout)}));
                    setPendingWorkout(null);
                    setView('Workout');
                  }}
                >
                  Replace active draft
                </Button>
              </div>
            )}
            {view === 'Workout' && state.active && (
              <div className='logger-layout'>
                <div>
                  <WorkoutView
                    workout={state.active}
                    dataset={allDataset}
                    onChange={(active) => setState((s) => ({...s, active}))}
                    onSource={source}
                  />
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
                    <Button onClick={() => setView('Templates')}>
                      <Layers size={16} /> Choose a template
                    </Button>
                    <Button variant='ghost' onClick={() => start(newWorkout())}>
                      <Plus size={16} /> Start empty
                    </Button>
                  </div>
                  {state.dataset && state.active.id.startsWith('demo-draft-') && (
                    <p className='draft-note'>
                      The initial draft uses synthetic preset targets. Choose a template or repeat
                      your own history to replace it.
                    </p>
                  )}
                </div>
                <aside className='summary'>
                  <span className='eyebrow'>THIS SESSION</span>
                  <h2>{state.active.name}</h2>
                  <div className='completion-stat'>
                    <strong>
                      {completed}
                      <span> / {sets.length}</span>
                    </strong>
                    <span>sets completed</span>
                  </div>
                  <div className='progress-track'>
                    <span
                      style={{width: `${sets.length ? (completed / sets.length) * 100 : 0}%`}}
                    />
                  </div>
                  <div className='summary-row'>
                    <span>Exercises</span>
                    <strong>{state.active.exercises.length}</strong>
                  </div>
                  <div className='summary-row'>
                    <span>Still to complete</span>
                    <strong>{sets.length - completed}</strong>
                  </div>
                  <p className='quiet-note'>
                    <ShieldCheck size={15} />
                    {persistenceError
                      ? 'Draft is only in memory. Browser storage could not be updated.'
                      : 'Your draft is saved automatically on this device, not backed up to a server.'}
                  </p>
                  <div className='session-note'>
                    <ClipboardList size={18} />
                    <p>
                      Prefilled numbers are targets.
                      <br />A checkmark records a completed set.
                    </p>
                  </div>
                </aside>
              </div>
            )}
            {view === 'Workout' && !state.active && (
              <div className='empty-state'>
                <Dumbbell size={28} />
                <h2>Ready for your next workout</h2>
                <p>Choose a template, repeat your history, or start with a clean slate.</p>
                <div>
                  <Button variant='primary' onClick={() => setView('Templates')}>
                    Choose a template
                  </Button>
                  <Button onClick={() => start(newWorkout())}>Start empty workout</Button>
                </div>
              </div>
            )}
            {view === 'History' && (
              <HistoryView
                workouts={allDataset.workouts}
                focusedId={focusedId}
                onRepeat={start}
                onTemplate={saveTemplate}
              />
            )}
            {view === 'Progress' && <ProgressView dataset={allDataset} onSource={source} />}
            {view === 'Templates' && (
              <TemplatesView
                templates={templates}
                dataset={allDataset}
                onChange={(templates, base) => setState((s) => ({...s, templates}), base)}
                onStart={start}
              />
            )}
            <footer className='page-foot'>
              Local-first logging · drafts are device-local · server sync is not off-device backup
            </footer>
          </fieldset>
        </main>
      </div>
      <Dialog.Root open={confirmFinish} onOpenChange={setConfirmFinish}>
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
              <Button variant='primary' disabled={maintenance || sync.locked} onClick={finish}>
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
