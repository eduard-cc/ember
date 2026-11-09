import {ArrowUpRight, Clock, Layers, Pencil, RotateCcw, Trash2, Trophy, Weight} from 'lucide-react';
import {createContext, useContext, useMemo, useRef, useState} from 'react';

import {
  type PersonalRecord,
  recordKindLabel,
  recordKinds,
  recordsAt,
  workoutVolume,
} from '../domain/finish-summary';
import {setCount} from '../domain/sets';
import type {Dataset, Workout} from '../domain/types';
import {durationLabel} from '../domain/workout-duration';
import {useBackLayer} from '../state/back';
import {dateLabel, fullDateTime} from '../utils/date';
import {plural} from '../utils/plural';
import {OptionsMenu} from './ExerciseMenu';
import {ExerciseThumb} from './ExerciseThumb';
import {HistoryEditor} from './HistoryEditor';
import {Stat} from './exercise-line';
import {RecordedSets} from './recorded-sets';
import {Button} from './ui/button';
import {DialogActions} from './ui/dialog';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './ui/responsive-dialog';

const kg = (n: number) => `${Math.round(n).toLocaleString('en-GB')} kg`;

/** The stats under a workout's name: duration and volume when known, PRs when it set any. */
export function WorkoutStats({
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

/** Every set of every exercise, with its records and the bounded estimate for weighted work. */
function WorkoutSets({workout, records}: {workout: Workout; records: PersonalRecord[]}) {
  return (
    <>
      {workout.exercises.map((exercise, i) => {
        const kinds = records
          .filter((record) => record.exercise === exercise.name)
          .sort((a, b) => recordKinds.indexOf(a.kind) - recordKinds.indexOf(b.kind));
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
            <RecordedSets sets={exercise.sets} type={exercise.type} className='mt-2' />
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

/** What a finished workout's drawer can do, provided once by the app shell. */
export type WorkoutActions = {
  onRepeat: (workout: Workout) => void;
  onTemplate: (workout: Workout) => void;
  /** Save an edited workout (`next`) or delete it (`next` null). */
  onChange: (base: Workout, next: Workout | null) => Promise<boolean>;
  /** Mirrors the library's disabled fieldset, which the portaled drawer and editor sit outside of. */
  disabled: boolean;
  /** Sync is locked: portaled dialogs escape <main hidden>, so they must unmount. */
  locked: boolean;
};

const WorkoutActionsContext = createContext<WorkoutActions | null>(null);
export const WorkoutActionsProvider = WorkoutActionsContext.Provider;

function useWorkoutActions() {
  const actions = useContext(WorkoutActionsContext);
  if (!actions) throw new Error('WorkoutDrawer needs a WorkoutActionsProvider');
  return actions;
}

/**
 * A finished workout's drawer, with Edit and Delete opening over it. It opens wherever it was
 * asked for (History, an exercise's details), so the page underneath stays as it was.
 */
export function WorkoutDrawer({
  dataset,
  workoutId,
  onClose,
  returnFocus,
}: {
  dataset: Dataset;
  /** The workout to show; null closes the drawer. */
  workoutId: string | null;
  onClose: () => void;
  /** Focus whatever opened this workout, once the drawer and its dialogs have closed. */
  returnFocus: (id: string) => void;
}) {
  const {onRepeat, onTemplate, onChange, disabled, locked} = useWorkoutActions();
  const [editing, setEditing] = useState<Workout | null>(null);
  const [deleting, setDeleting] = useState<Workout | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const open = (workoutId && dataset.workouts.find((w) => w.id === workoutId)) || null;
  // The drawer keeps its last workout while it slides away.
  const [shown, setShown] = useState<Workout | null>(open);
  if (open && open !== shown) setShown(open);
  const drawn = open ?? shown;
  const drawnRecords = useMemo(() => (drawn ? recordsAt(drawn, dataset) : []), [drawn, dataset]);
  useBackLayer(!!open && !locked, onClose);
  useBackLayer(!!deleting && !locked, () => setDeleting(null));
  // Edit and Delete open over the drawer, which stays as it was underneath; closing them goes
  // back to its ⋯ button. Without the drawer (a peer removed the workout), focus returns to
  // whatever opened the workout.
  const drawerOptions = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<string | null>(null);
  // Set when a drawer action leaves the drawer for another place (Repeat's logger, a template).
  const handedOff = useRef(false);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const id = returnTo.current;
    returnTo.current = null;
    const options = drawerOptions.current;
    if (options?.closest('[data-state=open]')) options.focus({preventScroll: true});
    else if (id) returnFocus(id);
  };
  const closeDrawer = (handOff: boolean) => {
    handedOff.current = handOff;
    onClose();
  };
  // Unmounted, not just closed, while locked: a closing drawer stays drawn while it slides
  // away, outside <main hidden>.
  if (locked) return null;
  return (
    <>
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
            else if (drawn) returnFocus(drawn.id);
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
              <ResponsiveDialogBody className='workout-drawer-body min-h-0 flex-1 overflow-y-auto overscroll-contain'>
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
                  ref={drawerOptions}
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
                        setEditing(drawn);
                      },
                    },
                    {
                      label: 'Delete workout',
                      icon: Trash2,
                      danger: true,
                      onSelect: () => {
                        returnTo.current = drawn.id;
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

      {editing && (
        <HistoryEditor
          key={editing.id}
          workout={editing}
          dataset={dataset}
          disabled={disabled}
          onSave={onChange}
          onClose={() => setEditing(null)}
          onCloseAutoFocus={restoreFocus}
          backLabel={open ? 'Back to workout' : undefined}
        />
      )}
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
                `${deleting.name} on ${dateLabel(deleting.date)} and its ${plural(setCount(deleting), 'set')} will be removed from history.`}
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
                  // The drawer showed this workout, so both close onto the page under it.
                  if (await onChange(deleting, null)) {
                    setDeleting(null);
                    onClose();
                  } else
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
    </>
  );
}
