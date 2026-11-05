import {
  ChevronDown,
  ChevronUp,
  Dumbbell,
  History,
  Plus,
  Search,
  Settings,
  User,
  X,
} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';

import {AddExercise} from './components/AddExercise';
import {AppearanceSettings, useAppearance} from './components/AppearanceSettings';
import {BodyWeightSettings} from './components/BodyWeightSettings';
import {ConditionsProvider, StatusPill, StatusStrips, appConditions} from './components/Conditions';
import {ElapsedTimer} from './components/ElapsedTimer';
import {ExercisePage} from './components/ExercisePage';
import {FeedbackSettings} from './components/FeedbackSettings';
import {type Celebration, FinishCelebration} from './components/FinishCelebration';
import {ShellUpdatePanel} from './components/ShellUpdatePanel';
import {StateNotice} from './components/StateNotice';
import {SyncLockedNotice} from './components/SyncStatus';
import {WorkoutActionsProvider} from './components/WorkoutDrawer';
import {EmberToaster, SETTINGS_TOASTER, toastDone, toastFailed} from './components/toasts';
import {Button} from './components/ui/button';
import {ContentFieldset} from './components/ui/content-fieldset';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './components/ui/dialog';
import {Input} from './components/ui/input';
import {ListLabel} from './components/ui/list-label';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './components/ui/responsive-dialog';
import {RollingNumber} from './components/ui/rolling-number';
import {SectionHeading} from './components/ui/section-heading';
import {routineTargets} from './components/workout-targets';
import {newRecords} from './domain/finish-summary';
import {countedSets} from './domain/sets';
import type {Workout} from './domain/types';
import {cue} from './feedback';
import {MOBILE_QUERY, useIsMobile} from './hooks/use-is-mobile';
import {useBackLayer} from './state/back';
import {newWorkout, useWorkoutState} from './state/workout';
import {useSync} from './sync/use-sync';
import {cn} from './utils/cn';
import {reducedMotion} from './utils/motion';
import {plural} from './utils/plural';
import {ExerciseDetail} from './views/ExerciseDetail';
import {ExercisesView} from './views/ExercisesView';
import {HistoryView} from './views/HistoryView';
import {ProfileView} from './views/ProfileView';
import {TemplatesView} from './views/TemplatesView';
import {WorkoutView} from './views/WorkoutView';

/** Drawer footers stack the primary action on top, like `DialogActions` on phones. */
const confirmFooter = 'max-desk:flex-col-reverse max-desk:*:min-h-12';
// The bar is a bottom tab strip below the `desk` breakpoint and a 48px header from it up. It is
// hidden while an editing input is focused on a phone. Search keeps the tabs available.
const appBarClass = [
  'app-bar shrink-0',
  'max-desk:order-1 max-desk:border-t max-desk:border-t-border max-desk:bg-card',
  'max-desk:[body:has(input:focus:not([type=search]))_&]:invisible',
  'desk:-order-1 desk:flex desk:h-12 desk:items-center desk:gap-6 desk:border-b desk:border-b-border desk:bg-background desk:px-7',
].join(' ');
// Tab: icon over label on a phone (2px top rule when active), text link with a 2px underline from
// `desk` up. Landscape phones switch to a row with a smaller min-height at any width.
const navItemClass = [
  'nav-item flex min-h-14 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 bg-transparent px-1 py-1 text-[11px] desk:px-3',
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
  const exerciseTrigger = useRef<HTMLElement | null>(null);
  const exerciseScroll = useRef(0);
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
  const [expanded, setExpandedState] = useState(true);
  const [sheetMotionArmed, armSheetMotion] = useState(false);
  /** Every expand/minimize is the owner's action, so from here on the sheet slides. */
  const expand = (next: boolean) => {
    armSheetMotion(true);
    setExpandedState(next);
  };
  const mobile = useIsMobile();
  const closeDesktopExercise = () => {
    setExercise(null);
    requestAnimationFrame(() => {
      const trigger = exerciseTrigger.current;
      const scroller = trigger?.closest('.library-scroll');
      if (scroller) scroller.scrollTop = exerciseScroll.current;
      trigger?.focus({preventScroll: true});
    });
  };

  const [confirmFinish, setConfirmFinish] = useState(false);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  // A sync lock hides history, so the celebration ends there rather than replaying on unlock.
  if (celebration && sync.locked) setCelebration(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [deletingSets, setDeletingSets] = useState(false);
  const [pendingWorkout, setPendingWorkout] = useState<Workout | null>(null);
  // The just-finished workout, marked at the top of History.
  const [finished, setFinished] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // The drawer button the reset confirmation returns to.
  const [resetTrigger, setResetTrigger] = useState<HTMLButtonElement | null>(null);
  useBackLayer(confirmReset, () => setConfirmReset(false));
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
          '.editor-scroll, .workout-scroll, .settings-panel, .library-scroll, .dialog-content',
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
    setFinished(null);
    setHistorySearch(false);
    setPendingWorkout(null);
  };
  // On phones an exercise's page is a dialog over the library, so it would cover the logger.
  const showLogger = () => {
    if (mobile) setExercise(null);
    expand(true);
  };
  const updateActive = (update: (active: Workout) => Workout) =>
    setState((s) => (s.active ? {...s, active: update(s.active)} : s));
  const start = (workout: Workout) => {
    if (state.active) setPendingWorkout(workout);
    else {
      cue('start');
      void setState((s) => ({...s, active: newWorkout(workout)}));
      setView('Workout');
      expand(true);
    }
  };
  // The template opens on the Workout tab, away from the drawer it was saved from, so it gets a
  // short toast; during a workout only a failure does. A failed commit keeps the template in
  // memory, so Retry commits the current state again rather than adding a second copy.
  const confirmTemplate = (saved: boolean, workout: boolean) => {
    if (!saved)
      toastFailed('Template not saved', () => {
        let running = false;
        void setState((s) => {
          running = !!s.active;
          return {...s};
        }).then((retried) => confirmTemplate(retried, running));
      });
    else if (!workout) toastDone('Template saved');
  };
  const saveTemplate = async (workout: Workout) => {
    setView('Workout');
    const saved = await setState((s) => ({
      ...s,
      templates: [...(s.templates ?? []), newWorkout(workout)],
    }));
    confirmTemplate(saved, !!state.active);
  };
  const sets = state.active?.exercises.flatMap((ex) => ex.sets) ?? [];
  const completed = state.active?.exercises.reduce((n, ex) => n + countedSets(ex).length, 0) ?? 0;
  const finish = async () => {
    if (!completed || deletingSets) return;
    const workout = await finishWorkout();
    // Only a committed finish celebrates; a failed one keeps the confirmation and its error.
    if (workout) {
      setConfirmFinish(false);
      setFinished(workout.id);
      setHistorySearch(false);
      setView('History');
      setExercise(null);
      setCelebration({workout, records: newRecords(workout, allDataset)});
    }
  };
  const disabled = !hydrated || readOnly || sync.locked || maintenance || !!recoveryError;
  const showSheet = !!state.active && expanded && !sync.locked;
  // On phones the sheet slides up when the owner opens it and down when it is minimized. Only
  // user actions animate (`expand`), so a draft restored at launch is simply there. While it
  // slides down it stays drawn but inert, then hides.
  const [sheetWasShown, setSheetWasShown] = useState(showSheet);
  const [sheetClosing, setSheetClosing] = useState(false);
  if (sheetWasShown !== showSheet) {
    setSheetWasShown(showSheet);
    setSheetClosing(
      !showSheet &&
        sheetMotionArmed &&
        !!state.active &&
        !sync.locked &&
        mobile &&
        !reducedMotion(),
    );
  }
  useEffect(() => {
    if (!sheetClosing) return;
    const timer = setTimeout(() => setSheetClosing(false), 300);
    return () => clearTimeout(timer);
  }, [sheetClosing]);
  const sheetDrawn = showSheet || (sheetClosing && !!state.active);
  // Back closes the newest layer; on a main tab with nothing open it leaves the app as before.
  // The expanded workout counts only on mobile, where it covers the tabs.
  useBackLayer(showSheet && mobile, () => expand(false));
  useBackLayer(view === 'Exercises' && !!exercise && !sync.locked, () => {
    if (mobile) setExercise(null);
    else closeDesktopExercise();
  });
  useBackLayer(settingsOpen, () => setSettingsOpen(false));
  useBackLayer(!!pendingWorkout && !sync.locked, () => setPendingWorkout(null));
  useBackLayer(confirmCancel && !sync.locked, () => setConfirmCancel(false));
  useBackLayer(confirmFinish && !sync.locked, () => {
    if (saveStatus !== 'saving') setConfirmFinish(false);
  });
  useBackLayer(!!celebration, () => setCelebration(null));
  // Sync is silent. Only conditions that need the owner, or heal by themselves, show, each in one
  // place: the logger while it is open, otherwise the page (or Settings over it).
  const conditions = appConditions({
    ownershipError,
    persistenceError,
    recoveryError,
    sync,
    onReset: (trigger) => {
      setResetTrigger(trigger);
      setConfirmReset(true);
    },
  });
  const pageConditions = !showSheet && !sync.locked && !settingsOpen;
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
  const shell = (
    <div
      className={`app-shell h-dvh ${showSheet ? 'sheet-open' : ''}`}
      data-save={saveStatus}
      data-sync={sync.status}
    >
      {sync.locked && (
        <div className='flex max-h-full flex-col overflow-auto'>
          {!settingsOpen && <StatusStrips />}
          <div className='px-[18px] py-3.5'>
            <div className='mb-3 flex justify-end'>{settingsButton()}</div>
            {!settingsOpen && <SyncLockedNotice sync={sync} />}
          </div>
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
          {/* Pinned under the status bar (the app bar on desktop); the title still scrolls. */}
          {pageConditions && <StatusStrips />}
          <div className='library-scroll min-h-0 flex-1 overflow-auto overscroll-contain px-8 pt-6.5 pb-10 max-desk:px-4.5 max-desk:pt-6 max-desk:pb-7.5'>
            {/* The title row sits outside the content fieldset, so the Profile cog (the phone entry
                to Settings; desktop has the header gear) also works while edits are disabled. The
                negative margins keep the 44px target from growing the 32px title row. */}
            <div className='mb-5 flex items-center justify-between gap-3'>
              <h1>{title}</h1>
              <div className='flex min-w-0 items-center gap-2'>
                {pageConditions && <StatusPill />}
                {view === 'Profile' && settingsButton('-my-1.5 -mr-2.5 desk:hidden')}
                {view === 'History' && (
                  <Button
                    variant='ghost'
                    size='icon'
                    className='history-search-trigger -my-1.5 -mr-2.5'
                    aria-label={historySearch ? 'Close search' : 'Search history'}
                    aria-expanded={historySearch}
                    onClick={() => setHistorySearch((value) => !value)}
                  >
                    {historySearch ? <X size={20} /> : <Search size={20} />}
                  </Button>
                )}
              </div>
            </div>
            <ContentFieldset disabled={disabled}>
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
                    disabled={disabled}
                    locked={sync.locked}
                    dataset={allDataset}
                    onChange={(templates, base) => setState((s) => ({...s, templates}), base)}
                    onStart={(workout) => start(routineTargets(workout, allDataset))}
                  />
                </>
              )}
              {view === 'History' && (
                <HistoryView
                  dataset={allDataset}
                  marked={finished}
                  searching={historySearch}
                  onSearchingChange={setHistorySearch}
                  locked={sync.locked}
                  downloading={!!sync.historyDownload}
                />
              )}
              {view === 'Exercises' && (
                <>
                  <div hidden={!!exercise && !mobile}>
                    <ExercisesView
                      dataset={allDataset}
                      onOpen={(name) => {
                        exerciseTrigger.current = document.activeElement as HTMLElement;
                        const scroller = exerciseTrigger.current.closest('.library-scroll');
                        exerciseScroll.current = scroller?.scrollTop ?? 0;
                        setExercise(name);
                        if (!mobile)
                          requestAnimationFrame(() => {
                            if (scroller) {
                              scroller.scrollTop = 0;
                              scroller
                                .querySelector<HTMLButtonElement>(
                                  'button[aria-label="Back to exercises"]',
                                )
                                ?.focus({preventScroll: true});
                            }
                          });
                      }}
                    />
                  </div>
                  {exercise && !mobile && (
                    <ExerciseDetail
                      key={exercise}
                      dataset={allDataset}
                      name={exercise}
                      onBack={closeDesktopExercise}
                    />
                  )}
                </>
              )}
              {view === 'Profile' && <ProfileView workouts={allDataset.workouts} />}
            </ContentFieldset>
          </div>
          {state.active && !showSheet && (
            <Button
              className='resume-bar group min-h-16 w-full shrink-0 justify-start gap-3 border-0 border-t bg-card px-[18px] py-2.5 text-left text-foreground shadow-[inset_3px_0_0_var(--color-primary)]'
              variant='secondary'
              aria-label={`Resume ${state.active.name}`}
              onClick={() => expand(true)}
            >
              <ChevronUp size={20} className='text-primary' />
              <div className='min-w-0'>
                <strong className='block truncate font-semibold'>{state.active.name}</strong>
                <span className='block text-[12px] text-muted-foreground group-hover:not-group-disabled:text-foreground'>
                  {/* Live: the workout is still running. */}
                  <span
                    className='relative mr-1.5 inline-grid size-2 -translate-y-px place-items-center align-middle'
                    aria-hidden='true'
                  >
                    <span className='live-dot-ping absolute size-2 animate-ping rounded-full bg-primary/60' />
                    <span className='live-dot size-1.5 rounded-full bg-primary' />
                  </span>
                  <ElapsedTimer
                    className='text-[12px] group-hover:not-group-disabled:text-foreground'
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
            hidden={!sheetDrawn}
            inert={!showSheet}
            aria-hidden={!showSheet || undefined}
            data-state={showSheet ? 'open' : 'closed'}
            data-motion={sheetMotionArmed || undefined}
          >
            <div className='flex h-full flex-col'>
              <header className='workout-top relative shrink-0 border-b border-border bg-card px-3 pt-2 pb-3 narrow:px-2'>
                <div className='flex items-center gap-1.5'>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label='Minimize workout'
                    onClick={() => expand(false)}
                  >
                    <ChevronDown size={22} />
                  </Button>
                  {settingsButton()}
                  {sheetDrawn && (
                    <ElapsedTimer start={state.active.date} className='flex-1 text-center' />
                  )}
                  <Button
                    variant='primary'
                    className='min-w-[88px]'
                    aria-label='Finish workout'
                    disabled={disabled || deletingSets || !completed}
                    onClick={() => {
                      cue('tick');
                      setConfirmFinish(true);
                    }}
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
                {sheetDrawn && (
                  <div className='workout-meta mx-1 mt-1 flex min-h-7 items-center justify-between gap-2 text-[12px] text-muted-foreground tabular-nums'>
                    <span className='shrink-0'>
                      <strong className='font-medium text-foreground'>
                        <RollingNumber value={completed} /> / {sets.length}
                      </strong>{' '}
                      {sets.length === 1 ? 'set' : 'sets'} completed
                    </span>
                    {showSheet && !settingsOpen && <StatusPill />}
                  </div>
                )}
                {/* Progress through the planned sets, over the header's bottom rule. */}
                <div className='absolute inset-x-0 -bottom-px h-0.5 bg-border' aria-hidden='true'>
                  <div
                    className='workout-progress h-full origin-left bg-primary transition-transform duration-300 ease-(--ease-out)'
                    style={{transform: `scaleX(${sets.length ? completed / sets.length : 0})`}}
                  />
                </div>
              </header>
              {showSheet && !settingsOpen && <StatusStrips />}
              <div className='workout-scroll min-h-0 flex-1 [scroll-padding:14px_0_30px] overflow-y-auto overscroll-contain'>
                <h2 className='sr-only'>Your workout</h2>
                <ContentFieldset disabled={disabled}>
                  <WorkoutView
                    key={state.active.id}
                    workout={state.active}
                    dataset={allDataset}
                    onChange={updateActive}
                    onDeletingChange={setDeletingSets}
                    sources
                    disabled={disabled}
                  />
                  <div className='flex flex-col gap-3 px-4 pt-[18px] pb-[30px]'>
                    <AddExercise
                      dataset={allDataset}
                      workoutName={state.active.name}
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
      {mobile && view === 'Exercises' && !sync.locked && (
        <ExercisePage
          name={exercise}
          dataset={allDataset}
          onClose={() => setExercise(null)}
          disabled={disabled}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            exerciseTrigger.current?.focus({preventScroll: true});
          }}
        />
      )}
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
            <div className='flex min-w-0 items-center gap-2'>
              <StatusPill />
              <DialogClose asChild>
                <Button aria-label='Close settings' variant='ghost' size='icon'>
                  <X size={20} />
                </Button>
              </DialogClose>
            </div>
          </SectionHeading>
          <DialogDescription srOnly>
            Appearance, feedback, body weight and app updates.
          </DialogDescription>
          <StatusStrips className='border' />
          {sync.locked && <SyncLockedNotice sync={sync} />}
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
          <EmberToaster id={SETTINGS_TOASTER} />
        </DialogContent>
      </Dialog>
      <ResponsiveDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <ResponsiveDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            resetTrigger?.focus();
          }}
        >
          <ResponsiveDialogHeader className='text-left'>
            <ResponsiveDialogTitle>Reset unreadable saved data?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Its original bytes will remain retained for recovery. This resets only unreadable
              device-local state, not server history.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter className={confirmFooter}>
            <ResponsiveDialogClose asChild>
              <Button>Keep saved data</Button>
            </ResponsiveDialogClose>
            <Button
              variant='danger'
              onClick={async () => {
                setConfirmReset(false);
                await resetUnreadableStorage();
              }}
            >
              Reset saved data
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      {/* Confirmations: bottom drawers on phones, a centred dialog from 1000px. Phones put
          the primary action on top; the first focus lands on the safe choice. */}
      <ResponsiveDialog
        open={!!pendingWorkout && !sync.locked}
        onOpenChange={(open) => {
          if (!open) setPendingWorkout(null);
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className='text-left'>
            <ResponsiveDialogTitle>Replace your active workout?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className='mt-2'>
              Your current workout will be discarded. All repeated sets start uncompleted.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter className={confirmFooter}>
            <Button
              onClick={() => {
                setPendingWorkout(null);
                showLogger();
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
                showLogger();
              }}
            >
              Replace active draft
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ResponsiveDialog open={confirmCancel && !sync.locked} onOpenChange={setConfirmCancel}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className='text-left'>
            <ResponsiveDialogTitle>Cancel this workout?</ResponsiveDialogTitle>
            {persistenceError && (
              <StateNotice
                title='Changes not saved'
                announcement={persistenceError}
                problem
                className='mt-2'
              >
                <p className='text-inherit'>{persistenceError}</p>
              </StateNotice>
            )}
            <ResponsiveDialogDescription className='mt-2'>
              {plural(sets.length, 'set')} will be discarded.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter className={confirmFooter}>
            <ResponsiveDialogClose asChild>
              <Button>Keep logging</Button>
            </ResponsiveDialogClose>
            <Button
              variant='danger'
              disabled={disabled || deletingSets}
              onClick={async () => {
                if (await setState((s) => ({...s, active: null}))) {
                  cue('delete');
                  setConfirmCancel(false);
                }
              }}
            >
              Discard workout
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ResponsiveDialog
        open={confirmFinish && !sync.locked}
        dismissible={saveStatus !== 'saving'}
        onOpenChange={(open) => {
          if (saveStatus !== 'saving') setConfirmFinish(open);
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className='text-left'>
            <ResponsiveDialogTitle>Finish this workout?</ResponsiveDialogTitle>
            {persistenceError && (
              <StateNotice
                title='Workout not saved'
                announcement={persistenceError}
                problem
                className='mt-2'
              >
                <p className='text-inherit'>{persistenceError}</p>
              </StateNotice>
            )}
            <ResponsiveDialogDescription className='mt-2'>
              {plural(completed, 'completed set')} will be saved. {sets.length - completed}{' '}
              uncompleted sets will be excluded.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter className={confirmFooter}>
            <ResponsiveDialogClose asChild>
              <Button disabled={saveStatus === 'saving'}>Keep logging</Button>
            </ResponsiveDialogClose>
            <Button
              variant='primary'
              disabled={disabled || deletingSets || !completed || saveStatus === 'saving'}
              onClick={finish}
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save finished workout'}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      {/* Over History, after the finish committed; a sync lock ends it, like other history views. */}
      <FinishCelebration celebration={celebration} onDone={() => setCelebration(null)} />
      {/* Settings shows its own toaster; this one waits behind it, so only one toast shows. */}
      <div hidden={settingsOpen}>
        <EmberToaster />
      </div>
    </div>
  );
  return (
    <ConditionsProvider conditions={conditions}>
      <WorkoutActionsProvider
        value={{
          onRepeat: start,
          onTemplate: (workout) => void saveTemplate(workout),
          onChange: changeHistoryWorkout,
          disabled,
          locked: sync.locked,
        }}
      >
        {shell}
      </WorkoutActionsProvider>
    </ConditionsProvider>
  );
}
