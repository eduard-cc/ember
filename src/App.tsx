import {ChevronDown, ChevronUp, Dumbbell, History, Plus, Settings, User, X} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';

import {AddExercise} from './components/AddExercise';
import {AppearanceSettings, useAppearance} from './components/AppearanceSettings';
import {BodyWeightSettings} from './components/BodyWeightSettings';
import {ElapsedTimer} from './components/ElapsedTimer';
import {FeedbackSettings} from './components/FeedbackSettings';
import {ShellUpdatePanel} from './components/ShellUpdatePanel';
import {SyncStatus} from './components/SyncStatus';
import {errorBannerClass, noticeClass} from './components/banner';
import {Button} from './components/ui/button';
import {ContentFieldset} from './components/ui/content-fieldset';
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogCornerClose,
  DialogDescription,
  DialogTitle,
} from './components/ui/dialog';
import {Input} from './components/ui/input';
import {ListLabel} from './components/ui/list-label';
import {SectionHeading} from './components/ui/section-heading';
import {Toaster} from './components/ui/sonner';
import {routineTargets} from './components/workout-targets';
import {countedSets} from './domain/sets';
import type {Workout} from './domain/types';
import {cue} from './feedback';
import {MOBILE_QUERY, useIsMobile} from './hooks/use-is-mobile';
import {useBackLayer} from './state/back';
import {newWorkout, useWorkoutState} from './state/workout';
import {useSync} from './sync/use-sync';
import {cn} from './utils/cn';
import {plural} from './utils/plural';
import {ExerciseDetail} from './views/ExerciseDetail';
import {ExercisesView} from './views/ExercisesView';
import {HistoryView} from './views/HistoryView';
import {ProfileView} from './views/ProfileView';
import {TemplatesView} from './views/TemplatesView';
import {WorkoutView} from './views/WorkoutView';

const stickyClass = 'sticky top-0 z-3';
// The bar is a bottom tab strip below the `desk` breakpoint and a 48px header from it up. It is
// hidden while an input is focused on a phone, because the keyboard covers it.
const appBarClass = [
  'app-bar shrink-0',
  'max-desk:order-1 max-desk:border-t max-desk:border-t-border max-desk:bg-card',
  'max-desk:[.app-shell:has(input:focus)_&]:invisible',
  'desk:-order-1 desk:flex desk:h-12 desk:items-center desk:gap-6 desk:border-b desk:border-b-border desk:bg-background desk:px-7',
].join(' ');
// Tab: icon over label on a phone (2px top rule when active), text link with a 2px underline from
// `desk` up. Landscape phones switch to a row with a smaller min-height at any width.
const navItemClass = [
  'nav-item flex min-h-14 min-w-19 flex-1 flex-col items-center justify-center gap-1 bg-transparent px-3 py-1 text-[11px]',
  'focus-visible:-outline-offset-2',
  'max-desk:border-t-2',
  'desk:min-h-12 desk:min-w-auto desk:flex-none desk:flex-row desk:border-b-2 desk:py-0 desk:text-[14px] desk:font-medium desk:[&_svg]:hidden',
  'short:min-h-12 short:flex-row short:gap-2',
].join(' ');
const idleNavItemClass =
  'font-medium text-muted-foreground max-desk:border-t-transparent desk:border-b-transparent';
const activeNavItemClass =
  'active font-medium text-primary max-desk:border-t-primary max-desk:font-semibold desk:border-b-primary desk:text-foreground';
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
  const mobile = useIsMobile();
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [deletingSets, setDeletingSets] = useState(false);
  const [pendingWorkout, setPendingWorkout] = useState<Workout | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const transitioning = useRef(false);
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
      const settled = await Promise.allSettled([sync.pause(), pauseEditing(requireSaved)]);
      if (settled.some((result) => result.status === 'rejected'))
        throw new Error('Could not pause safely');
      if (await repository.needsReconnect()) throw new Error('Reconnect first');
    } catch (error) {
      endTransition();
      throw error;
    }
  };
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let frame = 0;
    const revealField = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const field = document.activeElement;
        if (!(field instanceof HTMLInputElement) || !window.matchMedia(MOBILE_QUERY).matches)
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
  const dataset = useMemo(
    () =>
      state.dataset ?? {
        sourceLabel: 'History',
        workouts: [],
        warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
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
  const updateActive = (update: (active: Workout) => Workout) =>
    setState((s) => (s.active ? {...s, active: update(s.active)} : s));
  const start = (workout: Workout) => {
    if (state.active) setPendingWorkout(workout);
    else {
      cue('start');
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
  const completed = state.active?.exercises.reduce((n, ex) => n + countedSets(ex).length, 0) ?? 0;
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
  // In Settings the banners keep the 20px (and the issue text the 14px) top margin of the panel's
  // old `> .notice`, `> section` and `.dialog-content p` rules.
  const feedback = (className?: string) =>
    notice && (
      <div className={cn(noticeClass, 'mb-5', className)} role='status'>
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
    );
  // Sync is silent. Only states that need the owner surface here. In the logger the banners stay
  // on screen while a long workout scrolls.
  const errors = (where: 'page' | 'logger' | 'settings' = 'page') => {
    const banner = cn(errorBannerClass, where === 'logger' && stickyClass);
    return (
      <>
        {ownershipError && (
          <div className={banner} role='alert'>
            {ownershipError}
            <Button onClick={() => location.reload()}>Reload to enable editing</Button>
          </div>
        )}
        {persistenceError && (
          <div className={banner} role='alert'>
            {persistenceError}
            {recoveryError && (
              <Button
                variant='secondary'
                className='text-destructive'
                onClick={resetUnreadableStorage}
              >
                Reset unreadable saved data
              </Button>
            )}
          </div>
        )}
        {!sync.locked && sync.issues.length > 0 && (
          <section
            aria-label='Sync problems'
            className={cn(banner, where === 'settings' && 'mt-5')}
          >
            <p className={cn('text-inherit', where === 'settings' && 'mt-3.5')}>
              {plural(sync.issues.length, 'change')} could not sync. Later edits to the same item
              wait until this is resolved.
            </p>
            <ul className='w-full [overflow-wrap:anywhere]'>
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
  };
  const settingsButton = (className?: string) => (
    <Button
      variant='ghost'
      size='icon'
      aria-label='Settings'
      aria-expanded={settingsOpen}
      className={className}
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
      className={`app-shell h-dvh ${showSheet ? 'sheet-open' : ''}`}
      data-save={saveStatus}
      data-sync={sync.status}
    >
      {sync.locked && (
        <div className='flex items-center justify-between gap-3 px-[18px] py-3.5'>
          {!settingsOpen && (
            <>
              <SyncStatus sync={sync} />
              {errors()}
            </>
          )}
          {settingsButton()}
        </div>
      )}
      <main hidden={sync.locked} className='workspace relative m-auto flex h-full max-w-[1480px]'>
        <div
          className='library relative flex min-w-0 flex-1 flex-col [.sheet-open_&]:max-desk:invisible'
          inert={showSheet && mobile}
          aria-hidden={showSheet && mobile ? true : undefined}
        >
          <header className={appBarClass}>
            <span className='app-brand whitespace-nowrap max-desk:hidden desk:shrink-0 desk:text-base desk:font-semibold'>
              Ember
            </span>
            <nav
              aria-label='Main navigation'
              className='flex justify-around max-desk:w-full max-desk:px-2 max-desk:pb-[env(safe-area-inset-bottom)] desk:flex-1 desk:justify-start desk:gap-1'
            >
              {navigation.map(({name, icon: Icon}) => (
                <button
                  key={name}
                  className={cn(
                    navItemClass,
                    view === name ? activeNavItemClass : idleNavItemClass,
                  )}
                  aria-current={view === name ? 'page' : undefined}
                  onClick={() => go(name)}
                >
                  <Icon size={22} />
                  <span>{name}</span>
                </button>
              ))}
            </nav>
            <div className='max-desk:hidden desk:ml-auto'>{settingsButton()}</div>
          </header>
          <div className='library-scroll min-h-0 flex-1 overflow-auto overscroll-contain px-8 pt-6.5 pb-10 max-desk:px-4.5 max-desk:pt-6 max-desk:pb-7.5'>
            {/* The title row sits outside the content fieldset, so the Profile cog (the phone entry
                to Settings; desktop has the header gear) also works while edits are disabled. The
                negative margins keep the 44px target from growing the 32px title row. */}
            <div className='mb-5 flex items-center justify-between gap-3'>
              <h1>{title}</h1>
              {view === 'Profile' && settingsButton('-my-1.5 -mr-2.5 desk:hidden')}
            </div>
            {!showSheet && !sync.locked && !settingsOpen && errors()}
            {sync.historyDownload && !sync.locked && !(showSheet && mobile) && !settingsOpen && (
              <div className={cn(noticeClass, 'mb-5')} role='status' aria-label='History download'>
                {sync.historyDownload === 'waiting'
                  ? 'Your workout history has not finished downloading. It continues when your server is reachable.'
                  : 'Downloading your workout history from your server…'}
              </div>
            )}
            <ContentFieldset disabled={disabled}>
              {!showSheet && !settingsOpen && feedback()}
              {view === 'Workout' && !sync.locked && (
                <>
                  <section className='quick-start' aria-labelledby='quick-start'>
                    <ListLabel className='mt-0' id='quick-start'>
                      Quick start
                    </ListLabel>
                    <Button
                      variant='primary'
                      className='min-h-12 w-full'
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
                  />
                ) : (
                  <ExercisesView dataset={allDataset} onOpen={setExercise} />
                ))}
              {view === 'Profile' && <ProfileView workouts={allDataset.workouts} />}
            </ContentFieldset>
          </div>
          {state.active && !showSheet && (
            <Button
              className='resume-bar group min-h-16 w-full shrink-0 justify-start gap-3 border-0 border-t bg-card px-[18px] py-2.5 text-left text-foreground shadow-[inset_3px_0_0_var(--color-primary)]'
              variant='secondary'
              aria-label={`Resume ${state.active.name}`}
              onClick={() => setExpanded(true)}
            >
              <ChevronUp size={20} className='text-primary' />
              <div className='min-w-0'>
                <strong className='block truncate font-semibold'>{state.active.name}</strong>
                <span className='block text-[12px] text-muted-foreground group-[:hover:not(:disabled)]:text-foreground'>
                  <ElapsedTimer
                    className='text-[12px] group-[:hover:not(:disabled)]:text-foreground'
                    start={state.active.date}
                  />{' '}
                  · {completed} / {sets.length} sets
                </span>
              </div>
            </Button>
          )}
        </div>
        {/* Unmounted while locked: portaled dialogs (Previous evidence) escape <main hidden>. */}
        {state.active && !sync.locked && (
          <section
            className='workout-sheet flex h-full w-[500px] shrink-0 flex-col border-l border-border bg-background max-desk:absolute max-desk:inset-0 max-desk:z-5 max-desk:w-full max-desk:border-0'
            aria-label='Active workout'
            hidden={!showSheet}
          >
            <div className='flex h-full flex-col'>
              <header className='workout-top shrink-0 border-b border-border bg-card px-3 pt-2 pb-3 narrow:px-2'>
                <div className='flex items-center gap-1.5'>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label='Minimize workout'
                    onClick={() => setExpanded(false)}
                  >
                    <ChevronDown size={22} />
                  </Button>
                  {settingsButton()}
                  {showSheet && (
                    <ElapsedTimer start={state.active.date} className='flex-1 text-center' />
                  )}
                  <Button
                    variant='primary'
                    className='min-w-[88px]'
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
                  className='workout-title flex-1 border-0 bg-transparent px-1 py-0 text-[18px] font-semibold narrow:text-[16px]'
                  value={state.active.name}
                  onChange={(event) =>
                    updateActive((active) => ({...active, name: event.target.value}))
                  }
                />
                {showSheet && (
                  <div className='workout-meta mx-1 mt-1 flex items-center justify-between gap-2 text-[12px] text-muted-foreground tabular-nums'>
                    <span>
                      <strong className='font-medium text-foreground'>
                        {completed} / {sets.length}
                      </strong>{' '}
                      {sets.length === 1 ? 'set' : 'sets'} completed
                    </span>
                  </div>
                )}
              </header>
              <div className='workout-scroll min-h-0 flex-1 [scroll-padding:14px_0_30px] overflow-y-auto overscroll-contain'>
                <h2 className='sr-only'>Your workout</h2>
                {showSheet && !settingsOpen && (
                  <>
                    {errors('logger')}
                    {feedback()}
                  </>
                )}
                <ContentFieldset disabled={disabled}>
                  <WorkoutView
                    key={state.active.id}
                    workout={state.active}
                    dataset={allDataset}
                    onChange={updateActive}
                    onDeletingChange={setDeletingSets}
                    onSource={source}
                    disabled={disabled}
                  />
                  <div className='flex flex-col gap-3 px-4 pt-[18px] pb-[30px]'>
                    <AddExercise
                      dataset={allDataset}
                      existingNames={state.active.exercises.map((exercise) => exercise.name)}
                      onAdd={(exercise) =>
                        updateActive((active) => ({
                          ...active,
                          exercises: [...active.exercises, exercise],
                        }))
                      }
                    />
                    <Button
                      variant='secondary'
                      className='min-h-12 w-full text-destructive'
                      onClick={() => setConfirmCancel(true)}
                    >
                      Cancel workout
                    </Button>
                  </div>
                </ContentFieldset>
              </div>
            </div>
          </section>
        )}
      </main>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent
          variant='panel'
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            settingsTrigger.current?.focus();
          }}
        >
          <SectionHeading className='mb-6'>
            <DialogTitle>Settings</DialogTitle>
            <DialogClose asChild>
              <Button aria-label='Close settings' variant='ghost' size='icon'>
                <X size={20} />
              </Button>
            </DialogClose>
          </SectionHeading>
          <DialogDescription srOnly>
            Appearance, feedback, body weight and app updates.
          </DialogDescription>
          {errors('settings')}
          {feedback('mt-5')}
          <div className='mt-5 space-y-10'>
            <AppearanceSettings settings={appearance} />
            <FeedbackSettings />
            {/* Personal history: unmounted while sync is locked, like other owned data. */}
            {hydrated && !sync.locked && !recoveryError && (
              <BodyWeightSettings repository={repository} disabled={disabled} />
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
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pendingWorkout && !sync.locked}
        onOpenChange={(open) => {
          if (!open) setPendingWorkout(null);
        }}
      >
        <DialogContent>
          <DialogTitle className='pr-7'>Replace your active workout?</DialogTitle>
          <DialogDescription>
            Your current workout will be discarded. All repeated sets start uncompleted.
          </DialogDescription>
          <DialogActions>
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
                cue('start');
                void setState((s) => ({...s, active: newWorkout(pendingWorkout)}));
                setPendingWorkout(null);
                setExpanded(true);
              }}
            >
              Replace active draft
            </Button>
          </DialogActions>
          <DialogCornerClose label='Cancel replacement' />
        </DialogContent>
      </Dialog>
      <Dialog open={confirmCancel && !sync.locked} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogTitle>Cancel this workout?</DialogTitle>
          <DialogDescription>
            {plural(sets.length, 'set')} will be discarded. Finished workouts are not affected.
          </DialogDescription>
          <DialogActions>
            <DialogClose asChild>
              <Button>Keep logging</Button>
            </DialogClose>
            <Button
              variant='danger'
              disabled={disabled || deletingSets}
              onClick={async () => {
                if (await setState((s) => ({...s, active: null}))) setConfirmCancel(false);
              }}
            >
              Discard workout
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmFinish && !sync.locked} onOpenChange={setConfirmFinish}>
        <DialogContent>
          <DialogTitle className='pr-7'>Finish this workout?</DialogTitle>
          {persistenceError && (
            <p className='mt-3.5' role='alert'>
              {persistenceError}
            </p>
          )}
          <DialogDescription>
            {plural(completed, 'completed set')} will be saved. {sets.length - completed}{' '}
            uncompleted sets will be excluded.
          </DialogDescription>
          <DialogActions>
            <DialogClose asChild>
              <Button>Keep logging</Button>
            </DialogClose>
            <Button
              variant='primary'
              disabled={disabled || deletingSets || !completed}
              onClick={finish}
            >
              Save finished workout
            </Button>
          </DialogActions>
          <DialogCornerClose label='Close' />
        </DialogContent>
      </Dialog>
      {/* Mounted once. On phones toasts drop in from the top, under the status bar. */}
      <Toaster
        position={mobile ? 'top-center' : 'bottom-right'}
        offset={mobile ? {top: 'calc(env(safe-area-inset-top) + 16px)'} : undefined}
        mobileOffset={{top: 'calc(env(safe-area-inset-top) + 16px)'}}
      />
    </div>
  );
}
