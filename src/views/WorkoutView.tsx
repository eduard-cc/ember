import {Check, Plus} from 'lucide-react';
import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import {ExercisePicker} from '../components/AddExercise';
import type {ExcludeSetHandler} from '../components/ExcludeSet';
import {ExerciseMenu} from '../components/ExerciseMenu';
import {ReorderList, type ReorderStart, scrollParent, useHold} from '../components/ExerciseReorder';
import {ExerciseThumb} from '../components/ExerciseThumb';
import {PreviousSet} from '../components/PreviousSet';
import {ReplaceInput} from '../components/ReplaceInput';
import {SET_GRID, SetRow} from '../components/SetRow';
import {Button} from '../components/ui/button';
import {ContentFieldset} from '../components/ui/content-fieldset';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '../components/ui/dialog';
import {moveItem} from '../domain/reorder';
import type {Dataset, ExerciseLog, ExerciseType, SetRecord, Workout} from '../domain/types';
import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {plural} from '../utils/plural';
import {ExerciseDetail} from './ExerciseDetail';

export function dateLabel(date: string) {
  return new Date(date.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
export function validSet(set: SetRecord, type: ExerciseType) {
  const bounded = (value: number | null, min: number, max: number) =>
    value !== null && Number.isFinite(value) && value >= min && value <= max;
  if (type === 'duration' || type === 'cardio')
    return bounded(set.seconds, 1, 86400) && (type !== 'cardio' || bounded(set.distance, 0, 1000));
  return (
    bounded(set.reps, 1, 1000) &&
    Number.isInteger(set.reps) &&
    (type === 'bodyweight' || bounded(set.weight, 0, 2000))
  );
}
/** Set-row fields: centred 18/600 values; a completed row drops the field chrome. */
const setInput = (completed?: boolean) =>
  cn(
    'min-w-0 px-0.5 py-1.5 text-center set-value',
    completed && 'border-transparent bg-transparent disabled:bg-transparent',
  );

/** Only load conventions worth a reminder; plain weighted work needs no caption. */
function loadCaption(ex: ExerciseLog): string | null {
  switch (ex.type) {
    case 'weighted':
      return ex.name.includes('Dumbbell') ? 'Weight per dumbbell · kg' : null;
    case 'assisted':
      return 'Assistance in kg · less is better';
    case 'bodyweight':
      return 'Bodyweight · no added load';
    case 'duration':
      return 'Duration in seconds';
    case 'cardio':
      return 'Duration in seconds · distance in km';
  }
}

export function WorkoutView({
  workout,
  dataset,
  onChange,
  onSource,
  onDeletingChange,
  onExclude,
  disabled = false,
  targetsOnly = false,
}: {
  workout: Workout;
  dataset: Dataset;
  onChange: (update: Workout | ((current: Workout) => Workout)) => void;
  onSource: (id: string) => void;
  onDeletingChange: (deleting: boolean) => void;
  /** Given in the active workout: names and thumbnails then open the exercise's details. */
  onExclude?: ExcludeSetHandler;
  /** Mirrors the logger's disabled fieldset, which the portaled details sit outside of. */
  disabled?: boolean;
  targetsOnly?: boolean;
}) {
  // Save/Finish must wait for every exit, not just the first animated deletion.
  const deletingSets = useRef(new Set<string>());
  const setDeleting = useCallback(
    (id: string, deleting: boolean) => {
      if (deleting) deletingSets.current.add(id);
      else deletingSets.current.delete(id);
      onDeletingChange(deletingSets.current.size > 0);
    },
    [onDeletingChange],
  );
  const identities = useRef(new WeakMap<ExerciseLog, string>());
  const identity = (exercise: ExerciseLog) => {
    let id = identities.current.get(exercise);
    if (!id) {
      id = crypto.randomUUID();
      identities.current.set(exercise, id);
    }
    return id;
  };
  // Replace reuses the Add exercise picker; focus returns to the card's ⋯ button afterwards.
  const [replacing, setReplacing] = useState<string | null>(null);
  const menuButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterPicker = useRef<string | null>(null);
  // Exercise details layer over the logger, which stays mounted underneath: values, checks,
  // scroll position and the clock are untouched. Closing returns focus to the name button.
  const showDetails = !!onExclude && !targetsOnly;
  const [details, setDetails] = useState<{id: string; name: string} | null>(null);
  const detailButtons = useRef(new Map<string, HTMLButtonElement>());
  useBackLayer(details !== null, () => setDetails(null));
  // Read after close, when `details` has already been cleared.
  const detailsReturn = useRef<string | null>(null);
  const replaceExercise = (exerciseId: string, exercise: ExerciseLog) => {
    const nextId = crypto.randomUUID();
    identities.current.set(exercise, nextId);
    focusAfterPicker.current = nextId;
    // The replacement takes the same position; the old sets, completed or not, are dropped.
    onChange((current) => ({
      ...current,
      exercises: current.exercises.map((ex) => (identity(ex) === exerciseId ? exercise : ex)),
    }));
  };
  // Remove applies to the current draft by identity; focus moves to the neighbouring card's ⋯
  // (next, else previous), or to Add exercise when the list is empty.
  const list = useRef<HTMLDivElement>(null);
  const removeExercise = (exerciseId: string) => {
    const ids = workout.exercises.map((ex) => identity(ex));
    const at = ids.indexOf(exerciseId);
    const neighbour = ids[at + 1] ?? ids[at - 1];
    onChange((current) => ({
      ...current,
      exercises: current.exercises.filter((ex) => identity(ex) !== exerciseId),
    }));
    requestAnimationFrame(() => {
      const next = neighbour && menuButtons.current.get(neighbour);
      if (next) return next.focus({preventScroll: true});
      // Add exercise sits beside the list (logger tools or above it in the template editor).
      list.current?.parentElement
        ?.querySelector<HTMLButtonElement>('.add-exercise-button')
        ?.focus({preventScroll: true});
    });
  };
  // Press and hold a card's header: every card shrinks to a compact row and the held one follows
  // the finger. Dropping moves the whole exercise (sets, values and checks) by identity.
  const [reordering, setReordering] = useState<ReorderStart | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  // Set on drop/cancel: the card to keep under the finger once full cards are back, and where.
  const landing = useRef<{id: string; top: number; moved: boolean} | null>(null);
  // Focus inside the held card when it lifted (a field, ⋯); hiding the cards drops it.
  const focusBefore = useRef<HTMLElement | null>(null);
  // Screen-reader confirmation of where a moved exercise now is.
  const [announcement, setAnnouncement] = useState('');
  const announce = (exerciseId: string, to: number) => {
    const ex = workout.exercises.find((item) => identity(item) === exerciseId);
    if (ex)
      setAnnouncement(`Moved ${ex.name} to position ${to + 1} of ${workout.exercises.length}`);
  };
  const hold = useHold((start) => {
    // A set still sliding out would be cut short by the cards hiding; let it finish first.
    if (deletingSets.current.size) return false;
    const active = document.activeElement;
    focusBefore.current =
      active instanceof HTMLElement && cards.current.get(start.id)?.contains(active)
        ? active
        : null;
    setReordering(start);
  });
  const endReorder = (id: string, top: number, moved: boolean) => {
    landing.current = {id, top, moved};
    hold.release();
    setReordering(null);
  };
  const moveExercise = (exerciseId: string, to: number) =>
    onChange((current) => {
      const from = current.exercises.findIndex((ex) => identity(ex) === exerciseId);
      if (from < 0 || from === to) return current;
      return {...current, exercises: moveItem(current.exercises, from, to)};
    });
  // A brief tint marks where a moved exercise landed.
  const flash = (card: HTMLElement) => {
    delete card.dataset.dropped;
    void card.offsetWidth;
    card.dataset.dropped = '';
    card.addEventListener('animationend', () => delete card.dataset.dropped, {once: true});
  };
  // Before paint: put the dropped card's heading where its compact row was, then mark it.
  useLayoutEffect(() => {
    const land = landing.current;
    if (reordering || !land) return;
    landing.current = null;
    const card = cards.current.get(land.id);
    const heading = card?.querySelector('.exercise-heading');
    const scroller = scrollParent(card ?? null);
    if (!card || !heading) return;
    // Hiding the cards dropped focus; give it back only if it was in the held card. A touch
    // hold never focuses anything, so phone drags don't move focus (or make TalkBack speak).
    const before = focusBefore.current;
    focusBefore.current = null;
    if (
      before?.isConnected &&
      (!document.activeElement || document.activeElement === document.body)
    )
      before.focus({preventScroll: true});
    if (scroller) scroller.scrollTop += heading.getBoundingClientRect().top - land.top - 6;
    if (land.moved) flash(card);
  }, [reordering]);
  // The ⋯ menu's Move up/down: the keyboard and screen-reader path to the same result.
  const stepExercise = (exerciseId: string, by: number) => {
    const at = workout.exercises.findIndex((ex) => identity(ex) === exerciseId);
    moveExercise(exerciseId, at + by);
    announce(exerciseId, at + by);
    requestAnimationFrame(() => {
      // Moving a node in the DOM drops its focus; return it to the same ⋯ and keep that button
      // in view (a whole tall card aligned by its bottom edge would push ⋯ off screen).
      const button = menuButtons.current.get(exerciseId);
      button?.focus({preventScroll: true});
      button?.scrollIntoView({block: 'nearest'});
      const card = cards.current.get(exerciseId);
      if (card) flash(card);
    });
  };
  const changeExercise = (exercise: ExerciseLog, sets: SetRecord[]) => {
    const next = {...exercise, sets};
    identities.current.set(next, identity(exercise));
    return next;
  };
  const removeSet = (exercise: ExerciseLog, index: number) => {
    const exerciseId = identity(exercise);
    const setId = exercise.sets[index].id;
    // Exits can finish in the same frame. Apply each deletion to the current draft.
    onChange((current) => ({
      ...current,
      exercises: current.exercises.map((ex) =>
        identity(ex) === exerciseId
          ? changeExercise(
              ex,
              ex.sets.filter((set) => set.id !== setId),
            )
          : ex,
      ),
    }));
  };
  const edit = (ei: number, si: number, patch: Partial<SetRecord>) =>
    onChange({
      ...workout,
      exercises: workout.exercises.map((ex, i) =>
        i !== ei
          ? ex
          : changeExercise(
              ex,
              ex.sets.map((set, j) => {
                if (j !== si) return set;
                const next = {...set, ...patch};
                // A ticked set edited to an invalid value loses its tick; valid edits keep it.
                return next.completed && !validSet(next, ex.type)
                  ? {...next, completed: false}
                  : next;
              }),
            ),
      ),
    });
  // While an exercise is held the compact list stands in for the cards. They stay mounted but
  // hidden, so dropping doesn't rebuild every set row (and its history lookup) mid-animation.
  return (
    <div className='flex flex-col' ref={list}>
      {/* Portaled to <body>: modal dialogs keep live regions and their ancestors exposed to
          screen readers, so one inside the logger would expose the whole logger behind them. */}
      {createPortal(
        <div className='sr-only' aria-live='polite' data-reorder-announcement=''>
          {announcement}
        </div>,
        document.body,
      )}
      {reordering && (
        <ReorderList
          key={reordering.id}
          exercises={workout.exercises}
          identity={identity}
          start={reordering}
          onDrop={(to, top) => {
            const from = workout.exercises.findIndex((ex) => identity(ex) === reordering.id);
            moveExercise(reordering.id, to);
            if (from !== to) announce(reordering.id, to);
            endReorder(reordering.id, top, from !== to);
          }}
          onCancel={(top) => endReorder(reordering.id, top, false)}
          progress={
            targetsOnly
              ? undefined
              : (ex) => {
                  const done = ex.sets.filter((set) => set.completed && validSet(set, ex.type));
                  return `${done.length} / ${plural(ex.sets.length, 'set')}`;
                }
          }
        />
      )}
      {/* eslint-disable-next-line react-hooks/refs -- identity() reads a render-stable WeakMap cache of React keys; no React Compiler is in use. */}
      {workout.exercises.map((ex, ei) => {
        const timed = ex.type === 'cardio' || ex.type === 'duration';
        const checked = ex.sets.filter((set) => set.completed && validSet(set, ex.type)).length;
        const done = ex.sets.length > 0 && checked === ex.sets.length;
        return (
          <section
            className='exercise-card border-b border-border px-4 pt-5 pb-[18px] narrow:px-3 [.workout-sheet_&]:desk:px-6 [.workout-sheet_&]:desk:py-[22px]'
            key={identity(ex)}
            hidden={!!reordering}
            ref={(node) => {
              if (node) cards.current.set(identity(ex), node);
              else cards.current.delete(identity(ex));
            }}
          >
            <header
              className='exercise-heading mb-1 grid grid-cols-[40px_minmax(0,1fr)_auto] grid-rows-[minmax(22px,auto)_minmax(22px,auto)] items-center gap-x-2 select-none [-webkit-touch-callout:none]'
              onPointerDown={(event) => {
                // ⋯ keeps its own press; only the name, drawing and status lift the card.
                if ((event.target as HTMLElement).closest('.exercise-menu')) return;
                if (workout.exercises.length < 2) return;
                hold.begin(event, identity(ex), event.currentTarget.parentElement!);
              }}
            >
              {/* The heading keeps the plain name; the button inside says what it does. */}
              <h2
                className='exercise-title col-[1/3] row-[1/3] grid min-w-0 grid-cols-subgrid grid-rows-subgrid self-stretch text-[16px] leading-[1.35]'
                aria-labelledby={`${identity(ex)}-name`}
              >
                {showDetails ? (
                  <button
                    className='exercise-title-button col-[1/3] row-[1/3] grid min-h-11 min-w-0 grid-cols-subgrid grid-rows-subgrid items-center self-stretch border-0 bg-transparent p-0 text-left [&>.exercise-thumb]:col-1 [&>.exercise-thumb]:row-[1/3] [&>span:last-child]:col-2 [&>span:last-child]:row-1 [&>span:last-child]:self-end [&>span:last-child]:[overflow-wrap:anywhere] hover:[&>span:last-child]:underline hover:[&>span:last-child]:decoration-border hover:[&>span:last-child]:underline-offset-[3px]'
                    aria-label={`Show details for ${ex.name}`}
                    ref={(node) => {
                      if (node) detailButtons.current.set(identity(ex), node);
                      else detailButtons.current.delete(identity(ex));
                    }}
                    onClick={() => {
                      detailsReturn.current = identity(ex);
                      setDetails({id: identity(ex), name: ex.name});
                    }}
                  >
                    <ExerciseThumb name={ex.name} className='size-10' />
                    <span id={`${identity(ex)}-name`}>{ex.name}</span>
                  </button>
                ) : (
                  <span className='exercise-title-button col-[1/3] row-[1/3] grid min-h-11 min-w-0 grid-cols-subgrid grid-rows-subgrid items-center self-stretch border-0 bg-transparent p-0 text-left [&>.exercise-thumb]:col-1 [&>.exercise-thumb]:row-[1/3] [&>span:last-child]:col-2 [&>span:last-child]:row-1 [&>span:last-child]:self-end [&>span:last-child]:[overflow-wrap:anywhere]'>
                    <ExerciseThumb name={ex.name} className='size-10' />
                    <span id={`${identity(ex)}-name`}>{ex.name}</span>
                  </span>
                )}
              </h2>
              <div className='exercise-meta pointer-events-none col-2 row-2 min-w-0 self-start'>
                {!targetsOnly && (
                  <span
                    role='status'
                    aria-label='Exercise completion'
                    className={
                      done
                        ? 'exercise-done inline-flex items-center gap-1 text-[12px] font-semibold text-primary'
                        : 'exercise-count inline-flex items-center gap-1 text-[12px] text-muted-foreground'
                    }
                  >
                    {done ? (
                      <>
                        <Check size={14} />
                        Done
                      </>
                    ) : (
                      `${checked} / ${plural(ex.sets.length, 'set')}`
                    )}
                  </span>
                )}
                {targetsOnly && loadCaption(ex) && (
                  <p className='mt-[3px] text-[12px]'>{loadCaption(ex)}</p>
                )}
              </div>
              <ExerciseMenu
                className='col-3 row-[1/3] -mr-[13px]'
                name={ex.name}
                ref={(node) => {
                  if (node) menuButtons.current.set(identity(ex), node);
                  else menuButtons.current.delete(identity(ex));
                }}
                onReplace={() => {
                  focusAfterPicker.current = identity(ex);
                  setReplacing(identity(ex));
                }}
                onRemove={() => removeExercise(identity(ex))}
                onMoveUp={ei > 0 ? () => stepExercise(identity(ex), -1) : undefined}
                onMoveDown={
                  ei < workout.exercises.length - 1
                    ? () => stepExercise(identity(ex), 1)
                    : undefined
                }
              />
            </header>
            <div className='set-table'>
              <div
                className={cn(
                  SET_GRID,
                  'set-row set-head min-h-[30px] text-center text-[11px] text-muted-foreground',
                )}
              >
                <span>Set</span>
                <span>Previous</span>
                <span>{timed ? 'Seconds' : ex.type === 'assisted' ? 'Assist. kg' : 'kg'}</span>
                <span>{ex.type === 'duration' ? '' : timed ? 'km' : 'Reps'}</span>
                <span />
                <span className='desktop-remove hidden' />
              </div>
              {ex.sets.map((set, si) => (
                <SetRow
                  completed={set.completed}
                  key={set.id}
                  number={si + 1}
                  label={`${ex.name} set ${si + 1}`}
                  onDelete={() => removeSet(ex, si)}
                  onDeletingChange={(deleting) => setDeleting(set.id, deleting)}
                >
                  {targetsOnly ? (
                    <span />
                  ) : (
                    <PreviousSet
                      dataset={dataset}
                      exercise={ex}
                      set={set}
                      index={si}
                      onSource={onSource}
                    />
                  )}
                  <ReplaceInput
                    type='number'
                    className={setInput(set.completed)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || targetsOnly) return;
                      event.preventDefault();
                      if (ex.type === 'duration') {
                        if (!set.completed && validSet(set, ex.type))
                          edit(ei, si, {completed: true});
                        event.currentTarget.blur();
                      } else {
                        const row = event.currentTarget.closest('.set-row');
                        row?.querySelectorAll('input')[1]?.focus();
                      }
                    }}
                    inputMode={timed ? 'numeric' : 'decimal'}
                    min={timed ? 1 : 0}
                    max={timed ? 86400 : 2000}
                    step={timed ? 1 : 0.5}
                    disabled={ex.type === 'bodyweight'}
                    aria-label={`${timed ? 'Seconds' : 'Weight'} for ${ex.name} set ${si + 1}`}
                    value={(timed ? set.seconds : set.weight) ?? ''}
                    onValueChange={(value) =>
                      edit(ei, si, {
                        [timed ? 'seconds' : 'weight']: value === '' ? null : Number(value),
                      })
                    }
                  />
                  {ex.type === 'duration' ? (
                    <span className='text-center text-[12px] text-muted-foreground'>seconds</span>
                  ) : (
                    <ReplaceInput
                      type='number'
                      className={setInput(set.completed)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || targetsOnly) return;
                        event.preventDefault();
                        if (!set.completed && validSet(set, ex.type))
                          edit(ei, si, {completed: true});
                        event.currentTarget.blur();
                      }}
                      inputMode={timed ? 'decimal' : 'numeric'}
                      min={timed ? 0 : 1}
                      max='1000'
                      step={timed ? '0.01' : '1'}
                      aria-label={`${timed ? 'Distance in km' : 'Reps'} for ${ex.name} set ${si + 1}`}
                      value={(timed ? set.distance : set.reps) ?? ''}
                      onValueChange={(value) =>
                        edit(ei, si, {
                          [timed ? 'distance' : 'reps']: value === '' ? null : Number(value),
                        })
                      }
                    />
                  )}
                  {targetsOnly ? (
                    <span />
                  ) : (
                    <Button
                      size='icon'
                      className='set-check h-12 w-12'
                      variant={set.completed ? 'primary' : 'secondary'}
                      aria-pressed={!!set.completed}
                      aria-label={`${set.completed ? 'Uncomplete' : 'Complete'} ${ex.name} set ${si + 1}`}
                      disabled={!set.completed && !validSet(set, ex.type)}
                      onClick={() => edit(ei, si, {completed: !set.completed})}
                    >
                      {set.completed ? (
                        <Check size={19} />
                      ) : (
                        <span
                          className='unchecked-marker h-[30px] w-[30px] border-[1.5px] border-muted-foreground bg-card'
                          aria-hidden='true'
                        />
                      )}
                    </Button>
                  )}
                </SetRow>
              ))}
            </div>
            <Button
              variant='ghost'
              className='mt-1 w-full'
              onClick={() =>
                onChange({
                  ...workout,
                  exercises: workout.exercises.map((x, i) =>
                    i !== ei
                      ? x
                      : changeExercise(x, [
                          ...x.sets,
                          {
                            ...(x.sets.at(-1) ?? {
                              weight: null,
                              reps: null,
                              seconds: null,
                              distance: null,
                            }),
                            id: crypto.randomUUID(),
                            completed: false,
                          },
                        ]),
                  ),
                })
              }
            >
              <Plus size={16} /> Add set
            </Button>
          </section>
        );
      })}
      <ExercisePicker
        dataset={dataset}
        open={replacing !== null}
        onOpenChange={(open) => {
          if (!open) setReplacing(null);
        }}
        onPick={(exercise) => {
          if (replacing) replaceExercise(replacing, exercise);
        }}
        existingNames={workout.exercises
          // eslint-disable-next-line react-hooks/refs -- identity() reads the same render-stable React key cache as the cards above.
          .filter((exercise) => identity(exercise) !== replacing)
          .map((exercise) => exercise.name)}
        title='Replace exercise'
        description='Search or filter the exercise library and choose the exercise to put in its place.'
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = focusAfterPicker.current;
          focusAfterPicker.current = null;
          if (target) menuButtons.current.get(target)?.focus({preventScroll: true});
        }}
      />
      {showDetails && (
        <Dialog
          open={details !== null}
          onOpenChange={(open) => {
            if (!open) setDetails(null);
          }}
        >
          <DialogContent
            variant='workout'
            onCloseAutoFocus={(event) => {
              // Return focus to the name button without scrolling the logger.
              event.preventDefault();
              const target = detailsReturn.current;
              detailsReturn.current = null;
              if (target) detailButtons.current.get(target)?.focus({preventScroll: true});
            }}
          >
            <DialogDescription srOnly>
              About, history, charts and records from finished workouts. Your workout stays as you
              left it.
            </DialogDescription>
            {/* Only finished history is passed in, so the draft never counts as history. */}
            {details && (
              <ContentFieldset disabled={disabled}>
                <ExerciseDetail
                  key={details.name}
                  dataset={dataset}
                  name={details.name}
                  backLabel='Back to workout'
                  onBack={() => setDetails(null)}
                  onSource={(id) => {
                    // Like Previous evidence: minimizes the logger and opens History; draft kept.
                    setDetails(null);
                    onSource(id);
                  }}
                  onExclude={onExclude}
                  emptyFramed={false}
                  renderTitle={(heading) => (
                    <DialogTitle asChild className='pr-0'>
                      {heading}
                    </DialogTitle>
                  )}
                />
              </ContentFieldset>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
