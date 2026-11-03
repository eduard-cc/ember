import {ArrowLeft, ArrowUpRight, History, Info, Trophy} from 'lucide-react';
import {type ReactElement, type ReactNode, useId, useMemo, useState} from 'react';

import {bodyPartOf, catalogEntry} from '../catalog/catalog';
import {Drawing, ExerciseThumb} from '../components/ExerciseThumb';
import {Spoken} from '../components/exercise-line';
import {Button} from '../components/ui/button';
import {MetricExplanation} from '../components/ui/chart';
import {EmptyState} from '../components/ui/empty-state';
import {estimate1RM, exerciseWorkoutCount, getHistory, getRecords} from '../domain/model';
import type {Dataset, SetRecord} from '../domain/types';
import {cue} from '../feedback';
import {cn} from '../utils/cn';
import {dateLabel} from '../utils/date';
import {plural} from '../utils/plural';
import {setText} from '../utils/set-label';
import {ExerciseCharts} from './ExerciseCharts';

const tabs = ['Charts', 'History', 'Records', 'About'] as const;
type Tab = (typeof tabs)[number];
const kg = (n: number) => `${Number(n.toFixed(1))} kg`;
const kgReps = (n: number) => `${Number(n.toFixed(1))} kg·reps`;
const sessionHeadClass = 'text-[12px] font-medium text-muted-foreground';

function Fact({label, value}: {label: string; value: string}) {
  return (
    <div>
      <dt className='text-[12px] text-muted-foreground'>{label}</dt>
      <dd className='mt-1 text-[14px] font-medium wrap-anywhere'>{value}</dd>
    </div>
  );
}

function About({name, framed}: {name: string; framed: boolean}) {
  const entry = catalogEntry(name);
  if (!entry)
    return (
      <EmptyState
        icon={Info}
        title='Custom exercise'
        description='Not in the exercise catalog. Its history, charts and records are still here.'
        framed={framed}
      />
    );
  return (
    <div className='about space-y-7'>
      {entry.images.length > 0 && (
        <div
          className='about-drawings mx-auto grid max-w-[480px] grid-cols-2 gap-2.5'
          aria-hidden='true'
        >
          {entry.images.map((image) => (
            <Drawing
              key={image.file}
              file={image.file}
              className={cn(
                'aspect-square h-auto w-full rounded-none outline outline-border',
                // A single drawing keeps the size of one drawing in a start/finish pair.
                entry.images.length === 1 && 'col-span-full w-[calc(50%-5px)] justify-self-center',
              )}
            />
          ))}
        </div>
      )}
      {entry.images.length === 0 && (
        <p className='border border-border bg-card p-4 text-[14px] text-muted-foreground'>
          No drawing available.
        </p>
      )}
      <section>
        <h3 className='mb-3 text-[16px] font-semibold'>Exercise details</h3>
        <dl className='grid grid-cols-2 gap-4 border-t border-border pt-3'>
          <Fact label='Body part' value={entry.bodyPart} />
          <Fact label='Equipment' value={entry.equipment} />
        </dl>
      </section>
      {(entry.primaryMuscles.length > 0 || entry.secondaryMuscles.length > 0) && (
        <section>
          <h3 className='mb-3 text-[16px] font-semibold'>Muscles</h3>
          <dl className='grid gap-4 border-t border-border pt-3'>
            {entry.primaryMuscles.length > 0 && (
              <Fact label='Primary muscles' value={entry.primaryMuscles.join(', ')} />
            )}
            {entry.secondaryMuscles.length > 0 && (
              <Fact label='Secondary muscles' value={entry.secondaryMuscles.join(', ')} />
            )}
          </dl>
        </section>
      )}
    </div>
  );
}

function HistoryTab({
  dataset,
  name,
  onSource,
  framed,
}: {
  dataset: Dataset;
  name: string;
  onSource: (id: string) => void;
  framed: boolean;
}) {
  const [limit, setLimit] = useState(10);
  const history = useMemo(() => getHistory(dataset, name), [dataset, name]);
  if (!history.length)
    return (
      <EmptyState
        icon={History}
        title='No history yet'
        description='Sessions appear here after you finish a workout with this exercise.'
        framed={framed}
      />
    );
  return (
    <div className='flex flex-col gap-3'>
      {history.slice(0, limit).map((session, i) => (
        <article
          className='session-card min-w-0 border border-border bg-card'
          key={`${session.workoutId}-${i}`}
        >
          <header>
            <Button
              variant='ghost'
              className='w-full justify-between gap-3 px-4 py-3 text-left text-foreground'
              aria-label={`View source workout ${session.workoutName} ${dateLabel(session.date)}`}
              onClick={() => onSource(session.workoutId)}
            >
              <span className='min-w-0'>
                <span
                  role='heading'
                  aria-level={3}
                  className='block text-[16px] font-semibold tabular-nums'
                >
                  {dateLabel(session.date)}
                </span>
                <span className='mt-0.5 block text-[12px] font-normal wrap-anywhere text-muted-foreground'>
                  {session.workoutName} · {plural(session.sets.length, 'set')}
                </span>
              </span>
              <ArrowUpRight size={16} className='shrink-0 text-muted-foreground' />
            </Button>
          </header>
          <div className='border-t border-border px-4 pb-2'>
            <div className='flex justify-between gap-3 py-2'>
              <span className={sessionHeadClass}>Sets performed</span>
              {session.type === 'weighted' && (
                <span className={cn(sessionHeadClass, 'text-right')}>Epley est. 1RM</span>
              )}
            </div>
            <ol aria-label='Sets performed' className='m-0 list-none p-0'>
              {session.sets.map((set, j) => {
                const e1rm = estimate1RM(set, session.type);
                const actual = setText(set, session.type);
                return (
                  <li
                    key={set.id}
                    className='session-set flex min-h-10 items-baseline gap-3 py-2 tabular-nums'
                  >
                    <span className='w-5 shrink-0 text-[12px] text-muted-foreground'>{j + 1} </span>
                    <span className='min-w-0 flex-1 text-[16px] font-medium wrap-anywhere'>
                      <Spoken value={actual} />{' '}
                    </span>
                    {session.type === 'weighted' && (
                      <span className='max-w-[35%] text-right text-[12px] wrap-anywhere text-muted-foreground'>
                        {e1rm === null ? '—' : kg(e1rm)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </article>
      ))}
      {history.length > limit && (
        <Button onClick={() => setLimit((n) => n + 20)}>Show more sessions</Button>
      )}
    </div>
  );
}

function RecordsTab({
  dataset,
  name,
  onSource,
  framed,
}: {
  dataset: Dataset;
  name: string;
  onSource: (id: string) => void;
  framed: boolean;
}) {
  const records = useMemo(() => getRecords(dataset, name), [dataset, name]);
  const history = useMemo(() => getHistory(dataset, name), [dataset, name]);
  type Entry = {
    value: number;
    set?: SetRecord;
    workoutId: string;
    workoutName: string;
    date: string;
  };
  const row = (
    label: string,
    entry: Entry | null,
    format: (value: number) => string,
    showSet = true,
  ) => {
    if (!entry) return null;
    const value = format(entry.value);
    const set = entry.set;
    const type = set && history.find((session) => session.sets.includes(set))?.type;
    const actual = set && type ? setText(set, type) : null;
    return (
      <li key={label}>
        <Button
          variant='ghost'
          className='w-full justify-between gap-3 px-0 py-3 text-left text-foreground'
          aria-label={`View source workout for ${label}: ${value}${showSet && actual ? `, ${actual.spoken ?? actual.text}` : ''}, ${dateLabel(entry.date)}, ${entry.workoutName}`}
          onClick={() => onSource(entry.workoutId)}
        >
          <span className='min-w-0 flex-1'>
            <span className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
              <span className='text-[14px] font-medium'>{label}</span>
              <strong className='text-[18px] font-semibold tabular-nums'>{value}</strong>
            </span>
            {showSet && actual && (
              <span className='mt-1 block text-[14px] font-normal tabular-nums'>
                <Spoken value={actual} />
              </span>
            )}
            <span className='mt-1 block text-[12px] font-normal wrap-anywhere text-muted-foreground'>
              <span className='tabular-nums'>{dateLabel(entry.date)}</span> · {entry.workoutName}
            </span>
          </span>
          <ArrowUpRight size={16} className='shrink-0 text-muted-foreground' />
        </Button>
      </li>
    );
  };
  if (
    !records.heaviest &&
    !records.leastAssistance &&
    !records.mostReps &&
    !records.bestSetVolume &&
    !records.sessionVolume &&
    !records.estimated &&
    !records.repBests.length
  )
    return (
      <EmptyState
        icon={Trophy}
        title='No records yet'
        description='Records come from your completed sets.'
        framed={framed}
      />
    );
  const actualRecords = [
    row('Heaviest weight', records.heaviest, kg),
    row('Least assistance', records.leastAssistance, kg),
  ].filter(Boolean);
  const otherRecords = [
    row('Most reps in a set', records.mostReps, (value) => `${value} reps`),
    row('Best set volume', records.bestSetVolume, kgReps),
    row('Best session volume', records.sessionVolume, kgReps),
  ].filter(Boolean);
  return (
    <div className='records min-w-0 space-y-7'>
      {actualRecords.length > 0 && (
        <section>
          <h3 className='mb-1 text-[16px] font-semibold'>Recorded performance</h3>
          <ul
            className='m-0 list-none divide-y divide-border p-0'
            aria-label='Recorded performance'
          >
            {actualRecords}
          </ul>
        </section>
      )}
      {records.repBests.length > 0 && (
        <section>
          <h3 className='mb-1 text-[16px] font-semibold'>Heaviest weight by reps</h3>
          <ul
            className='m-0 list-none divide-y divide-border p-0'
            aria-label='Heaviest weight by reps'
          >
            {records.repBests.map((best) =>
              row(plural(best.reps, 'rep'), best, () => setText(best.set, 'weighted').text, false),
            )}
          </ul>
        </section>
      )}
      {otherRecords.length > 0 && (
        <section>
          <h3 className='mb-1 text-[16px] font-semibold'>
            {actualRecords.length ? 'Other records' : 'Recorded performance'}
          </h3>
          <ul className='m-0 list-none divide-y divide-border p-0' aria-label='Other records'>
            {otherRecords}
          </ul>
        </section>
      )}
      {records.estimated && (
        <section>
          <h3 className='mb-1 text-[16px] font-semibold'>Estimated strength</h3>
          <ul className='m-0 list-none p-0'>
            {row('Estimated 1RM (Epley)', records.estimated, kg)}
          </ul>
          <MetricExplanation>
            Epley estimate: weight × (1 + reps / 30), for weighted sets of 1–10 reps. One rep uses
            recorded weight. An estimate, not a tested maximum.
          </MetricExplanation>
        </section>
      )}
    </div>
  );
}

/** Exercise evidence: Charts / History / Records / About, traceable to recorded sets. */
export function ExerciseDetail({
  dataset,
  name,
  onBack,
  onSource,
  backLabel = 'Back to exercises',
  renderTitle = (heading) => heading,
  emptyFramed = true,
}: {
  dataset: Dataset;
  name: string;
  onBack: () => void;
  onSource: (id: string) => void;
  backLabel?: string;
  /** Lets a dialog host wrap the name heading as its accessible title. */
  renderTitle?: (heading: ReactElement) => ReactNode;
  /** False when a dialog hosts the details: empty states then sit on its surface unframed. */
  emptyFramed?: boolean;
}) {
  // Unique workouts, matching the Exercises list; History/Charts/Records stay per exercise block.
  const workouts = useMemo(() => exerciseWorkoutCount(dataset, name), [dataset, name]);
  const [tab, setTab] = useState<Tab>(workouts ? 'Charts' : 'About');
  const [tabMotion, setTabMotion] = useState(false);
  // The library and the workout can both show details at once; ids must stay unique.
  const id = useId();
  return (
    <div className='exercise-detail'>
      <header className='detail-header mb-3.5 flex items-center gap-3'>
        <Button variant='ghost' size='icon' aria-label={backLabel} onClick={onBack}>
          <ArrowLeft size={20} />
        </Button>
        <ExerciseThumb name={name} />
        <div className='min-w-0'>
          {renderTitle(<h2 className='text-[18px] wrap-anywhere'>{name}</h2>)}
          <p className='mt-0.5 text-[12px] text-muted-foreground'>
            {bodyPartOf(name)} · {plural(workouts, 'workout')}
          </p>
        </div>
      </header>
      <div
        className='exercise-tabs sticky -top-6 z-1 -mx-1 mb-[18px] flex border-b border-border bg-background [.exercise-detail-panel_&]:max-desk:-top-[18px]'
        role='tablist'
        aria-label='Exercise sections'
      >
        {tabs.map((value) => (
          <button
            key={value}
            role='tab'
            id={`${id}-tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`${id}-panel`}
            tabIndex={tab === value ? 0 : -1}
            className='min-h-[46px] min-w-0 flex-1 border-0 bg-transparent text-[14px] font-medium text-muted-foreground focus-visible:-outline-offset-2 aria-selected:text-foreground'
            onClick={(event) => {
              setTabMotion(event.detail > 0);
              cue('tick');
              setTab(value);
            }}
            onKeyDown={(event) => {
              const index = tabs.indexOf(value);
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              setTabMotion(false);
              setTab(tabs[next]);
              document.getElementById(`${id}-tab-${tabs[next]}`)?.focus();
            }}
          >
            {value}
          </button>
        ))}
        <span
          aria-hidden='true'
          className={cn(
            'tab-underline pointer-events-none absolute -bottom-px left-0 h-0.5 w-1/4 bg-primary',
            tabMotion && 'transition-transform duration-200 ease-(--ease-out)',
          )}
          style={{transform: `translateX(${tabs.indexOf(tab) * 100}%)`}}
        />
      </div>
      <div role='tabpanel' id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
        {tab === 'About' && <About name={name} framed={emptyFramed} />}
        {tab === 'History' && (
          <HistoryTab dataset={dataset} name={name} onSource={onSource} framed={emptyFramed} />
        )}
        {tab === 'Charts' && (
          <ExerciseCharts
            key={name}
            dataset={dataset}
            name={name}
            onSource={onSource}
            framed={emptyFramed}
          />
        )}
        {tab === 'Records' && (
          <RecordsTab dataset={dataset} name={name} onSource={onSource} framed={emptyFramed} />
        )}
      </div>
    </div>
  );
}
