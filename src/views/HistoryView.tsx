import {History, Loader, Search} from 'lucide-react';
import {useMemo, useRef, useState} from 'react';

import {WorkoutDrawer, WorkoutStats} from '../components/WorkoutDrawer';
import {ExerciseLine} from '../components/exercise-line';
import {Button} from '../components/ui/button';
import {EmptyState} from '../components/ui/empty-state';
import {Input} from '../components/ui/input';
import {recordsAt} from '../domain/finish-summary';
import type {Dataset, Workout} from '../domain/types';
import {cue} from '../feedback';
import {useIsMobile} from '../hooks/use-is-mobile';
import {useBackLayer} from '../state/back';
import {cn} from '../utils/cn';
import {dateLabel, monthLabel, weekdayLabel} from '../utils/date';
import {plural} from '../utils/plural';

const PAGE = 20;
const CARD_LINES = 5;

export function HistoryView({
  dataset,
  marked,
  searching,
  onSearchingChange,
  locked,
  downloading,
}: {
  dataset: Dataset;
  /** The just-finished workout, marked with an Amber border. */
  marked: string | null;
  /** The search field is shown, from the search button beside the page title. */
  searching: boolean;
  onSearchingChange: (searching: boolean) => void;
  /** Sync is locked: search's back layer stands down with the rest of the page. */
  locked: boolean;
  /** The history download is partial, so the list may end early. */
  downloading: boolean;
}) {
  const mobile = useIsMobile();

  const workouts = dataset.workouts;
  const [search, setSearch] = useState('');
  const cancelSearch = () => {
    setSearch('');
    onSearchingChange(false);
  };
  useBackLayer(searching && mobile && !locked, cancelSearch);
  const [limit, setLimit] = useState(PAGE);
  // Closing or reopening search starts it empty, on the first page.
  const [wasSearching, setWasSearching] = useState(searching);
  if (wasSearching !== searching) {
    setWasSearching(searching);
    setSearch('');
    setLimit(PAGE);
  }
  const [openId, setOpenId] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());

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

  const searchField = (
    <label className='relative block'>
      <Search
        size={16}
        className='pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground'
        aria-hidden
      />
      <Input
        type='search'
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
            cancelSearch();
          }
        }}
      />
    </label>
  );
  return (
    <div className='history-list flex flex-col gap-3'>
      {searching && searchField}
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
              const focused = marked === workout.id;
              return (
                <li key={workout.id} className={cn(focused && 'focused-history')}>
                  <article
                    className={cn(
                      'history-card pressable relative grid h-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] content-start gap-x-3.5 border bg-card p-4 hover:bg-accent/60 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                      focused ? 'border-primary' : 'border-border',
                    )}
                  >
                    {/* The whole card is this button's target, lifted above the rows: drawings are
                        masks, which paint over an unlifted button and swallow its taps. */}
                    <button
                      type='button'
                      ref={(node) => {
                        if (node) cards.current.set(workout.id, node);
                        else cards.current.delete(workout.id);
                      }}
                      className='absolute inset-0 z-1 focus-visible:outline-none'
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
        (query || !downloading) &&
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
      {/* A partial download never reads as a short or empty history. */}
      {downloading && filtered.length <= limit && (
        <p className='history-downloading flex items-center justify-center gap-2 border border-dashed border-border px-4 py-4 text-center text-[13px] text-muted-foreground'>
          <Loader size={14} aria-hidden='true' className='shrink-0 motion-safe:animate-slow-spin' />
          {workouts.length
            ? 'Older workouts are still downloading'
            : 'Your workouts are still downloading'}
        </p>
      )}

      <WorkoutDrawer
        dataset={dataset}
        workoutId={openId}
        onClose={() => setOpenId(null)}
        returnFocus={(id) => cards.current.get(id)?.focus({preventScroll: true})}
      />
    </div>
  );
}
