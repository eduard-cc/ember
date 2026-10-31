import {ArrowLeft, ArrowUpRight, History, Info, Trophy} from 'lucide-react';
import {type ReactElement, type ReactNode, useId, useMemo, useState} from 'react';

import {bodyPartOf, catalogEntry} from '../catalog/catalog';
import {Drawing, ExerciseThumb} from '../components/ExerciseThumb';
import {Button} from '../components/ui/button';
import {MetricExplanation} from '../components/ui/chart';
import {TextAction, dataTableClass} from '../components/ui/data-table';
import {EmptyState} from '../components/ui/empty-state';
import {ListLabel} from '../components/ui/list-label';
import {estimate1RM, exerciseWorkoutCount, getHistory, getRecords} from '../domain/model';
import type {Dataset, SetRecord} from '../domain/types';
import {cn} from '../utils/cn';
import {dateLabel} from '../utils/date';
import {plural} from '../utils/plural';
import {setLabel} from '../utils/set-label';
import {ExerciseCharts} from './ExerciseCharts';

const tabs = ['About', 'History', 'Charts', 'Records'] as const;
type Tab = (typeof tabs)[number];
const kg = (n: number) => `${Number(n.toFixed(1))} kg`;
const kgReps = (n: number) => `${Number(n.toFixed(1))} kg·reps`;
const sessionHeadClass = 'text-[12px] font-medium text-muted-foreground';

function Fact({label, value}: {label: string; value: string}) {
  return (
    <div>
      <dt className='text-[12px] text-muted-foreground'>{label}</dt>
      <dd className='mt-0.5 font-medium'>{value}</dd>
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
    <div className='about'>
      {entry.images.length > 0 && (
        <div className='about-drawings mb-4 grid grid-cols-2 gap-2.5'>
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
      <dl className='mb-1.5 grid grid-cols-[1fr_1fr] gap-x-4 gap-y-3'>
        <Fact label='Body part' value={entry.bodyPart} />
        <Fact label='Equipment' value={entry.equipment} />
        {entry.primaryMuscles.length > 0 && (
          <Fact label='Primary' value={entry.primaryMuscles.join(', ')} />
        )}
        {entry.secondaryMuscles.length > 0 && (
          <Fact label='Secondary' value={entry.secondaryMuscles.join(', ')} />
        )}
      </dl>
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
          className='session-card border border-border bg-card pt-1 pr-1.5 pb-3 pl-4'
          key={`${session.workoutId}-${i}`}
        >
          <header className='flex items-center justify-between gap-2'>
            <div>
              <h3 className='mt-2 text-[16px] font-semibold'>{session.workoutName}</h3>
              <p className='text-[12px] text-muted-foreground'>{dateLabel(session.date)}</p>
            </div>
            <Button
              size='icon'
              variant='ghost'
              aria-label={`View source workout ${session.workoutName} ${dateLabel(session.date)}`}
              onClick={() => onSource(session.workoutId)}
            >
              <ArrowUpRight size={16} />
            </Button>
          </header>
          <div
            className={cn(
              'mt-1.5 grid items-center gap-x-3 gap-y-1 pr-2.5 text-[14px] tabular-nums',
              session.type === 'weighted' ? 'grid-cols-[1fr_auto]' : 'grid-cols-[1fr]',
            )}
          >
            <span className={sessionHeadClass}>Sets performed</span>
            {session.type === 'weighted' && <span className={sessionHeadClass}>Est. 1RM</span>}
            {session.sets.map((set, j) => {
              const e1rm = estimate1RM(set, session.type);
              return (
                <div key={set.id} className='session-set contents'>
                  <span>
                    <b className='inline-block min-w-[22px] font-semibold text-muted-foreground'>
                      {j + 1}
                    </b>
                    {setLabel(set, session.type)}
                  </span>
                  {session.type === 'weighted' && <span>{e1rm === null ? '—' : kg(e1rm)}</span>}
                </div>
              );
            })}
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
  const type = useMemo(() => getHistory(dataset, name)[0]?.type, [dataset, name]);
  const rows: {label: string; value: string; detail: string; workoutId: string}[] = [];
  const add = (
    label: string,
    entry: {value: number; set?: SetRecord; workoutId: string; date: string} | null,
    format: (n: number) => string,
  ) => {
    if (entry)
      rows.push({
        label,
        value: format(entry.value),
        detail: `${entry.set && type ? setLabel(entry.set, type) + ' · ' : ''}${dateLabel(entry.date)}`,
        workoutId: entry.workoutId,
      });
  };
  add('Estimated 1RM (Epley)', records.estimated, kg);
  add('Heaviest weight', records.heaviest, kg);
  add('Best set volume', records.bestSetVolume, kgReps);
  add('Best session volume', records.sessionVolume, kgReps);
  add('Least assistance', records.leastAssistance, kg);
  add('Most reps in a set', records.mostReps, (n) => `${n} reps`);
  if (!rows.length)
    return (
      <EmptyState
        icon={Trophy}
        title='No records yet'
        description='Records come from your completed sets.'
        framed={framed}
      />
    );
  return (
    <div className='records'>
      <ul className='m-0 list-none p-0'>
        {rows.map((row) => (
          <li
            key={row.label}
            className='flex min-h-[60px] items-center gap-2.5 border-b border-border'
          >
            <div className='flex min-w-0 flex-1 flex-col'>
              <span>{row.label}</span>
              <small className='text-[12px] text-muted-foreground'>{row.detail}</small>
            </div>
            <strong className='tabular-nums'>{row.value}</strong>
            <Button
              size='icon'
              variant='ghost'
              aria-label={`View source workout for ${row.label}`}
              onClick={() => onSource(row.workoutId)}
            >
              <ArrowUpRight size={16} />
            </Button>
          </li>
        ))}
      </ul>
      {records.estimated && (
        <MetricExplanation>
          Estimated 1RM uses Epley, weight × (1 + reps / 30), on weighted sets of 1–10 reps. It is
          an estimate, not a tested maximum. Assisted and bodyweight work get no estimate.
        </MetricExplanation>
      )}
      {records.repBests.length > 0 && (
        <>
          <ListLabel>Heaviest weight by reps</ListLabel>
          <table className={dataTableClass} aria-label='Heaviest weight by reps'>
            <thead>
              <tr>
                <th>Reps</th>
                <th>Best performance</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {records.repBests.map((best) => (
                <tr key={best.reps}>
                  <td>{best.reps}</td>
                  <td>{kg(best.value)}</td>
                  <td>
                    <TextAction
                      aria-label={`View source workout ${best.reps} reps ${dateLabel(best.date)}`}
                      onClick={() => onSource(best.workoutId)}
                    >
                      {dateLabel(best.date)} <ArrowUpRight size={13} />
                    </TextAction>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Strong-style exercise screen: About / History / Charts / Records, all traceable to sets. */
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
  const [tab, setTab] = useState<Tab>(workouts ? 'History' : 'About');
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
          {renderTitle(<h2 className='text-[18px]'>{name}</h2>)}
          <p className='mt-0.5 text-[12px] text-muted-foreground'>
            {bodyPartOf(name)} · {plural(workouts, 'workout')}
          </p>
        </div>
      </header>
      <div
        className='sticky -top-6 z-1 -mx-1 mb-[18px] flex border-b border-border bg-background [.exercise-detail-panel_&]:max-desk:-top-[18px]'
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
            className='min-h-[46px] flex-1 border-0 border-b-2 border-b-transparent bg-transparent text-[14px] font-medium text-muted-foreground focus-visible:-outline-offset-2 aria-selected:border-b-primary aria-selected:text-foreground'
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
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
