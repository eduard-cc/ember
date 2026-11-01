import {
  ArrowUpRight,
  Clock,
  History,
  Layers,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Trophy,
  Weight,
} from 'lucide-react';
import {useMemo, useRef, useState} from 'react';

import {OptionsMenu} from '../components/ExerciseMenu';
import {ExerciseThumb} from '../components/ExerciseThumb';
import {HistoryEditor} from '../components/HistoryEditor';
import {ExerciseLine, Spoken, Stat} from '../components/exercise-line';
import {Button} from '../components/ui/button';
import {DialogActions} from '../components/ui/dialog';
import {EmptyState} from '../components/ui/empty-state';
import {Input} from '../components/ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '../components/ui/responsive-dialog';
import {
  type PersonalRecord,
  recordKindLabel,
  recordKinds,
  recordsAt,
  workoutVolume,
} from '../domain/finish-summary';
import {estimate1RM} from '../domain/model';
import {setCount} from '../domain/sets';
import type {Dataset, ExerciseType, Workout} from '../domain/types';
import {durationLabel} from '../domain/workout-duration';
import {cue} from '../feedback';
import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {dateLabel, fullDateTime, monthLabel, weekdayLabel} from '../utils/date';
import {plural} from '../utils/plural';
import {setText} from '../utils/set-label';

const PAGE = 20;
const CARD_LINES = 5;

const kg = (n: number) => `${Math.round(n).toLocaleString('en-GB')} kg`;

/** The stats under a workout's name: duration and volume when known, PRs when it set any. */
function WorkoutStats({
  workout,
  records,
  sets = false,
  id,
}: {
  workout: Workout;
  records: PersonalRecord[];
  sets?: boolean;
  id?: string;
}) {
  const volume = workoutVolume(workout);
  return (
    <p id={id} className='flex flex-wrap gap-x-3.5 gap-y-1'>
      {!!workout.duration && <Stat icon={Clock}>{durationLabel(workout.duration)}</Stat>}
      {sets && <Stat icon={Layers}>{plural(setCount(workout), 'set')}</Stat>}
      {volume > 0 && <Stat icon={Weight}>{kg(volume)}</Stat>}
      {records.length > 0 && (
        <Stat icon={Trophy} className='font-medium text-primary'>
          {records.length} {records.length === 1 ? 'PR' : 'PRs'}
        </Stat>
      )}
    </p>
  );
}

const valueHeading: Record<ExerciseType, string> = {
  weighted: 'Weight × reps',
  assisted: 'Assistance × reps',
  bodyweight: 'Reps',
  duration: 'Time',
  cardio: 'Distance · time',
};

/** Every set of every exercise, with its records and the bounded estimate for weighted work. */
function WorkoutSets({workout, records}: {workout: Workout; records: PersonalRecord[]}) {
  return (
    <>
      {workout.exercises.map((exercise, i) => {
        const kinds = records
          .filter((record) => record.exercise === exercise.name)
          .sort((a, b) => recordKinds.indexOf(a.kind) - recordKinds.indexOf(b.kind));
        const weighted = exercise.type === 'weighted';
        return (
          <section key={i} className='border-b border-border py-4 last:border-b-0'>
            <div className='flex items-center gap-3'>
              <ExerciseThumb name={exercise.name} className='size-10' />
              <div className='min-w-0 flex-1'>
                <h3 className='line-clamp-2 text-card-title [overflow-wrap:anywhere]'>
                  {exercise.name}
                </h3>
                {kinds.length > 0 && (
                  <p className='flex items-start gap-1 text-[12px] text-pretty text-primary'>
                    <Trophy
                      size={14}
                      className='mt-px shrink-0'
                      aria-label='Personal records'
                      role='img'
                    />
                    <span>{kinds.map((record) => recordKindLabel[record.kind]).join(' · ')}</span>
                  </p>
                )}
              </div>
            </div>
            <table className='recorded-sets mt-2 w-full text-sm tabular-nums'>
              <thead>
                <tr className='text-[11px] text-muted-foreground'>
                  <th scope='col' className='w-12 py-1.5 text-left font-normal'>
                    Set
                  </th>
                  <th scope='col' className='py-1.5 text-left font-normal'>
                    {valueHeading[exercise.type]}
                  </th>
                  {weighted && (
                    <th scope='col' className='py-1.5 text-right font-normal'>
                      Est. 1RM
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {exercise.sets.map((set, j) => {
                  const estimate = weighted ? estimate1RM(set, exercise.type) : null;
                  return (
                    <tr key={set.id} className='border-t border-border'>
                      <td className='h-10 text-muted-foreground'>{j + 1}</td>
                      <td className='font-semibold [overflow-wrap:anywhere]'>
                        <Spoken value={setText(set, exercise.type)} />
                      </td>
                      {weighted && (
                        <td className='text-right text-muted-foreground'>
                          {estimate === null ? '—' : `${Number(estimate.toFixed(1))} kg`}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      {workout.exercises.some((exercise) => exercise.type === 'weighted') && (
        <p className='pb-4 text-[12px]'>
          Est. 1RM uses the Epley formula and is shown for weighted sets of 1–10 reps.
        </p>
      )}
    </>
  );
}

export function HistoryView({
  dataset,
  focus,
  searching,
  onSearchingChange,
  onRepeat,
  onTemplate,
  onChange,
  disabled,
  locked,
}: {
  dataset: Dataset;
  /** The workout to mark (a finish) or, with `open`, to open (a source link). */
  focus: {id: string; open: boolean} | null;
  /** The search field is shown, from the search button beside the page title. */
  searching: boolean;
  onSearchingChange: (searching: boolean) => void;
  onRepeat: (workout: Workout) => void;
  onTemplate: (workout: Workout) => void;
  /** Save an edited workout (`next`) or delete it (`next` null). */
  onChange: (base: Workout, next: Workout | null) => Promise<boolean>;
  /** Mirrors the library's disabled fieldset, which the portaled drawer and editor sit outside of. */
  disabled: boolean;
  /** Sync is locked: portaled dialogs escape <main hidden>, so they must unmount. */
  locked: boolean;
}) {
  const workouts = dataset.workouts;
  const [editing, setEditing] = useState<Workout | null>(null);
  const [deleting, setDeleting] = useState<Workout | null>(null);
  const [deleteError, setDeleteError] = useState('');
  // Enough pages to include a workout, so its card is there for focus to return to.
  const pagesFor = (id: string | undefined) =>
    Math.max(PAGE, Math.ceil((workouts.findIndex((w) => w.id === id) + 1) / PAGE) * PAGE);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(() => (focus?.open ? pagesFor(focus.id) : PAGE));
  // Closing or reopening search starts it empty, on the first page. This runs before the focus
  // check below, so a source link that also closes search keeps the page its workout is on.
  const [wasSearching, setWasSearching] = useState(searching);
  if (wasSearching !== searching) {
    setWasSearching(searching);
    setSearch('');
    setLimit(PAGE);
  }
  // A source link opens its workout; a new focus opens it even while History is showing.
  const [openId, setOpenId] = useState<string | null>(focus?.open ? focus.id : null);
  const [seenFocus, setSeenFocus] = useState(focus);
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    if (focus?.open) {
      setOpenId(focus.id);
      setLimit((n) => Math.max(n, pagesFor(focus.id)));
    }
  }
  const open = (openId && workouts.find((w) => w.id === openId)) || null;
  // The drawer keeps its last workout while it slides away.
  const [shown, setShown] = useState<Workout | null>(open);
  if (open && open !== shown) setShown(open);
  const drawn = open ?? shown;
  useBackLayer(!!open && !locked, () => setOpenId(null));
  useBackLayer(!!deleting && !locked, () => setDeleting(null));
  const cards = useRef(new Map<string, HTMLButtonElement>());
  // Focus returns to the workout's card when the editor or the confirmation closes.
  const returnTo = useRef<string | null>(null);
  // Set when a drawer action hands focus to what it opens (the editor, a confirmation, the logger).
  const handedOff = useRef(false);
  const focusCard = () => {
    const id = returnTo.current;
    returnTo.current = null;
    if (id) cards.current.get(id)?.focus({preventScroll: true});
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    focusCard();
  };
  const closeDrawer = (handOff: boolean) => {
    handedOff.current = handOff;
    setOpenId(null);
  };

  const query = searching ? search.trim().toLowerCase() : '';
  const filtered = useMemo(
    () =>
      workouts.filter(
        (w) =>
          !query ||
          `${w.name} ${w.date} ${monthLabel(w.date)} ${w.exercises.map((x) => x.name).join(' ')}`
            .toLowerCase()
            .includes(query),
      ),
    [workouts, query],
  );
  // The records each workout set at the time, computed only for what is on screen.
  const {visible, records} = useMemo(() => {
    const visible = filtered.slice(0, limit);
    return {
      visible,
      records: new Map(visible.map((w) => [w.id, recordsAt(w, dataset)])),
    };
  }, [filtered, limit, dataset]);
  const drawnRecords = useMemo(
    () => (drawn ? (records.get(drawn.id) ?? recordsAt(drawn, dataset)) : []),
    [drawn, records, dataset],
  );
  const months = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of filtered) {
      const key = w.date.slice(0, 7);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [filtered]);
  const groups: {key: string; items: Workout[]}[] = [];
  for (const w of visible) {
    const key = w.date.slice(0, 7);
    if (groups.at(-1)?.key !== key) groups.push({key, items: []});
    groups.at(-1)!.items.push(w);
  }

  return (
    <div className='history-list flex flex-col gap-3'>
      {searching && (
        <label className='relative block'>
          <Search
            size={16}
            className='pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground'
            aria-hidden
          />
          <Input
            autoFocus
            aria-label='Search workout history'
            placeholder='Workouts, exercises or months'
            className='pl-9'
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onSearchingChange(false);
              }
            }}
          />
        </label>
      )}
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`month-${group.key}`}>
          {/* Sticky and solid, so cards pass under it. The negative top cancels the scroller's
              top padding, so it sticks flush with the scroller's edge. */}
          <div className='month-label sticky -top-6 z-10 -mx-4.5 flex items-baseline justify-between gap-3 bg-background px-4.5 py-2.5 desk:-top-6.5 desk:-mx-8 desk:px-8'>
            <h2 id={`month-${group.key}`} className='text-[12px] font-medium text-foreground'>
              {monthLabel(group.items[0].date)}
            </h2>
            <span className='text-[12px] text-muted-foreground tabular-nums'>
              {plural(months.get(group.key) ?? 0, 'workout')}
            </span>
          </div>
          <ul className='grid gap-3 desk:grid-cols-2 desk:logger-open:grid-cols-1'>
            {group.items.map((workout) => {
              const workoutRecords = records.get(workout.id) ?? [];
              const recordNames = new Set(workoutRecords.map((record) => record.exercise));
              const focused = focus?.id === workout.id;
              return (
                <li key={workout.id} className={cn(focused && 'focused-history')}>
                  <article
                    className={cn(
                      'history-card pressable relative grid h-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] content-start gap-x-3.5 border bg-card p-4 hover:bg-accent/60 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                      focused ? 'border-primary' : 'border-border',
                    )}
                  >
                    {/* The whole card is this button's target; the rows stay readable under it. */}
                    <button
                      type='button'
                      ref={(node) => {
                        if (node) cards.current.set(workout.id, node);
                        else cards.current.delete(workout.id);
                      }}
                      className='absolute inset-0 focus-visible:outline-none'
                      aria-label={`${workout.name}, ${dateLabel(workout.date)}`}
                      aria-describedby={`stats-${workout.id}`}
                      onClick={() => {
                        cue('tick');
                        setOpenId(workout.id);
                      }}
                    />
                    <div className='pt-0.5 text-center' aria-hidden='true'>
                      <p className='text-[11px] text-muted-foreground uppercase'>
                        {weekdayLabel(workout.date)}
                      </p>
                      <p className='mt-1 text-xl leading-none font-semibold text-foreground tabular-nums'>
                        {Number(workout.date.slice(8, 10))}
                      </p>
                    </div>
                    <div className='min-w-0'>
                      <h3 className='line-clamp-2 text-card-title [overflow-wrap:anywhere]'>
                        {workout.name}
                      </h3>
                      <WorkoutStats
                        id={`stats-${workout.id}`}
                        workout={workout}
                        records={workoutRecords}
                      />
                    </div>
                    {/* Under the name; below 350px across the whole card, so names keep room. */}
                    <ul className='col-start-2 mt-2.5 grid gap-0.5 border-t border-border pt-2 narrow:col-span-2 narrow:col-start-1'>
                      {workout.exercises.slice(0, CARD_LINES).map((exercise, i) => (
                        <ExerciseLine
                          key={i}
                          exercise={exercise}
                          record={recordNames.has(exercise.name)}
                        />
                      ))}
                    </ul>
                    {workout.exercises.length > CARD_LINES && (
                      <p className='col-start-2 mt-1 pl-[52px] text-[12px] text-muted-foreground tabular-nums narrow:col-span-2 narrow:col-start-1'>
                        + {workout.exercises.length - CARD_LINES} more
                      </p>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {filtered.length > limit && (
        <Button onClick={() => setLimit((n) => n + PAGE)}>Show older workouts</Button>
      )}
      {!filtered.length &&
        (query ? (
          <EmptyState
            icon={Search}
            title='No matching workouts'
            description={`Nothing matches “${search.trim()}”. Try a workout name, an exercise or a month.`}
          />
        ) : (
          <EmptyState
            icon={History}
            title='No workouts yet'
            description='Finished workouts appear here, newest first.'
          />
        ))}

      {/* Unmounted, not just closed, while locked: a closing drawer stays drawn while it slides
          away, outside <main hidden>. */}
      {!locked && (
        <ResponsiveDialog
          open={!!open}
          onOpenChange={(next) => {
            if (!next) closeDrawer(false);
          }}
        >
          <ResponsiveDialogContent
            className='workout-drawer max-desk:max-h-[calc(100dvh-2.5rem)] desk:flex desk:flex-col'
            onCloseAutoFocus={(event: Event) => {
              event.preventDefault();
              if (handedOff.current) handedOff.current = false;
              else if (drawn) cards.current.get(drawn.id)?.focus({preventScroll: true});
            }}
          >
            {drawn && (
              <>
                <ResponsiveDialogHeader className='shrink-0 border-b border-border pr-14 pb-3 text-left desk:pr-7'>
                  <ResponsiveDialogTitle className='[overflow-wrap:anywhere]'>
                    {drawn.name}
                  </ResponsiveDialogTitle>
                  <ResponsiveDialogDescription className='desk:mt-0'>
                    {fullDateTime(drawn.date)}
                  </ResponsiveDialogDescription>
                  <WorkoutStats workout={drawn} records={drawnRecords} sets />
                </ResponsiveDialogHeader>
                <ResponsiveDialogBody className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
                  <WorkoutSets workout={drawn} records={drawnRecords} />
                </ResponsiveDialogBody>
                <div className='grid shrink-0 grid-cols-[1fr_auto_auto] gap-2 border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] desk:px-0 desk:pt-5 desk:pb-0 narrow:grid-cols-[1fr_auto]'>
                  <Button
                    variant='primary'
                    className='min-h-12 narrow:col-span-full'
                    disabled={disabled}
                    aria-label={`Repeat workout ${drawn.name} ${dateLabel(drawn.date)}`}
                    onClick={() => {
                      closeDrawer(true);
                      onRepeat(drawn);
                    }}
                  >
                    <RotateCcw size={16} /> Repeat
                  </Button>
                  <Button
                    className='min-h-12 whitespace-nowrap'
                    disabled={disabled}
                    onClick={() => {
                      closeDrawer(true);
                      onTemplate(drawn);
                    }}
                  >
                    <ArrowUpRight size={16} /> Save as template
                  </Button>
                  <OptionsMenu
                    className='[&>button]:size-12'
                    variant='secondary'
                    disabled={disabled}
                    label={`Workout options for ${drawn.name} ${dateLabel(drawn.date)}`}
                    title={drawn.name}
                    items={[
                      {
                        label: 'Edit workout',
                        icon: Pencil,
                        onSelect: () => {
                          returnTo.current = drawn.id;
                          closeDrawer(true);
                          setEditing(drawn);
                        },
                      },
                      {
                        label: 'Delete workout',
                        icon: Trash2,
                        danger: true,
                        onSelect: () => {
                          returnTo.current = drawn.id;
                          closeDrawer(true);
                          setDeleteError('');
                          setDeleting(drawn);
                        },
                      },
                    ]}
                  />
                </div>
                <ResponsiveDialogCornerClose label='Close workout' />
              </>
            )}
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

      {editing && !locked && (
        <HistoryEditor
          key={editing.id}
          workout={editing}
          dataset={dataset}
          disabled={disabled}
          onSave={onChange}
          onClose={() => {
            setEditing(null);
            requestAnimationFrame(focusCard);
          }}
        />
      )}
      {!locked && (
        <ResponsiveDialog
          open={!!deleting}
          onOpenChange={(next) => {
            if (!next) setDeleting(null);
          }}
        >
          <ResponsiveDialogContent className='delete-workout' onCloseAutoFocus={restoreFocus}>
            <ResponsiveDialogHeader className='text-left'>
              <ResponsiveDialogTitle>Delete this workout?</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {deleting &&
                  `${deleting.name} on ${dateLabel(deleting.date)} and its ${plural(setCount(deleting), 'set')} will be removed from history, records and charts on every device.`}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className='pb-[calc(1rem+env(safe-area-inset-bottom))] desk:pb-0'>
              {deleteError && (
                <p className='mt-3.5' role='alert'>
                  {deleteError}
                </p>
              )}
              <DialogActions>
                <ResponsiveDialogClose asChild>
                  <Button>Keep workout</Button>
                </ResponsiveDialogClose>
                <Button
                  variant='danger'
                  disabled={disabled}
                  onClick={async () => {
                    if (!deleting) return;
                    if (await onChange(deleting, null)) setDeleting(null);
                    else
                      setDeleteError(
                        'Not deleted. The workout may have changed on another device; close and retry.',
                      );
                  }}
                >
                  Delete workout
                </Button>
              </DialogActions>
            </ResponsiveDialogBody>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
    </div>
  );
}
