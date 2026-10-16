import {ArrowLeft, ArrowUpRight} from 'lucide-react';
import {type ReactElement, type ReactNode, useId, useState} from 'react';

import {bodyPartOf, catalogEntry} from '../catalog/catalog';
import {ExcludeSet, type ExcludeSetHandler} from '../components/ExcludeSet';
import {Drawing, ExerciseThumb} from '../components/ExerciseThumb';
import {Button} from '../components/ui/button';
import {estimate1RM, exerciseWorkoutCount, getHistory, getRecords} from '../domain/model';
import type {Dataset, ExerciseType, SetRecord} from '../domain/types';
import {plural} from '../utils/plural';
import {ExerciseCharts} from './ExerciseCharts';
import {dateLabel} from './WorkoutView';

const tabs = ['About', 'History', 'Charts', 'Records'] as const;
type Tab = (typeof tabs)[number];
const kg = (n: number) => `${Number(n.toFixed(1))} kg`;

export function setLabel(set: SetRecord, type: ExerciseType) {
  if (type === 'duration' || type === 'cardio')
    return `${set.seconds ?? '—'} s${set.distance !== null ? ` · ${set.distance} km` : ''}`;
  if (type === 'bodyweight' || set.weight === null) return `BW × ${set.reps ?? '—'}`;
  return `${set.weight} kg${type === 'assisted' ? ' assist.' : ''} × ${set.reps ?? '—'}`;
}

function About({name}: {name: string}) {
  const entry = catalogEntry(name);
  if (!entry)
    return (
      <div className='empty-state'>
        <h2>Custom exercise</h2>
        <p>Not in the exercise catalog. Its history, charts and records are still here.</p>
      </div>
    );
  return (
    <div className='about'>
      {entry.images.length > 0 && (
        <div className='about-drawings'>
          {entry.images.map((image) => (
            <Drawing key={image.file} file={image.file} className='drawing large-drawing' />
          ))}
        </div>
      )}
      <dl className='about-facts'>
        <div>
          <dt>Body part</dt>
          <dd>{entry.bodyPart}</dd>
        </div>
        <div>
          <dt>Equipment</dt>
          <dd>{entry.equipment}</dd>
        </div>
        {entry.primaryMuscles.length > 0 && (
          <div>
            <dt>Primary</dt>
            <dd>{entry.primaryMuscles.join(', ')}</dd>
          </div>
        )}
        {entry.secondaryMuscles.length > 0 && (
          <div>
            <dt>Secondary</dt>
            <dd>{entry.secondaryMuscles.join(', ')}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function HistoryTab({
  dataset,
  name,
  onSource,
  onExclude,
}: {
  dataset: Dataset;
  name: string;
  onSource: (id: string) => void;
  onExclude: ExcludeSetHandler;
}) {
  const [limit, setLimit] = useState(10);
  const history = getHistory(dataset, name);
  if (!history.length)
    return (
      <div className='empty-state'>
        <h2>No history yet</h2>
        <p>Sessions appear here after you finish a workout with this exercise.</p>
      </div>
    );
  return (
    <div className='session-cards'>
      {history.slice(0, limit).map((session, i) => (
        <article className='session-card' key={`${session.workoutId}-${i}`}>
          <header>
            <div>
              <h3>{session.workoutName}</h3>
              <p>{dateLabel(session.date)}</p>
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
          <div className='session-sets'>
            <span className='session-sets-head'>Sets performed</span>
            {session.type === 'weighted' && <span className='session-sets-head'>Est. 1RM</span>}
            <span className='session-sets-head'>
              <span className='sr-only'>Analytics</span>
            </span>
            {session.sets.map((set, j) => {
              const e1rm = estimate1RM(set, session.type);
              return (
                <div key={set.id} className={`session-set ${set.excluded ? 'excluded-set' : ''}`}>
                  <span>
                    <b>{j + 1}</b>
                    {setLabel(set, session.type)}
                    {set.suspicious ? ' · flagged' : ''}
                    {set.excluded ? ' · excluded' : ''}
                  </span>
                  {session.type === 'weighted' && <span>{e1rm === null ? '—' : kg(e1rm)}</span>}
                  <ExcludeSet
                    workoutId={session.workoutId}
                    date={session.date}
                    exercise={name}
                    set={set}
                    number={j + 1}
                    type={session.type}
                    onExclude={onExclude}
                  />
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
}: {
  dataset: Dataset;
  name: string;
  onSource: (id: string) => void;
}) {
  const records = getRecords(dataset, name);
  const type = getHistory(dataset, name)[0]?.type;
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
  add('Best set volume', records.bestSetVolume, (n) => `${Number(n.toFixed(1))} kg·reps`);
  add('Best session volume', records.sessionVolume, (n) => `${Number(n.toFixed(1))} kg·reps`);
  add('Least assistance', records.leastAssistance, kg);
  add('Most reps in a set', records.mostReps, (n) => `${n} reps`);
  if (!rows.length)
    return (
      <div className='empty-state'>
        <h2>No records yet</h2>
        <p>Records come from your completed sets.</p>
      </div>
    );
  return (
    <div className='records'>
      <ul className='record-list'>
        {rows.map((row) => (
          <li key={row.label}>
            <div>
              <span>{row.label}</span>
              <small>{row.detail}</small>
            </div>
            <strong>{row.value}</strong>
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
        <p className='metric-explanation'>
          Estimated 1RM uses Epley, weight × (1 + reps / 30), on weighted sets of 1–10 reps. It is
          an estimate, not a tested maximum. Assisted and bodyweight work get no estimate.
        </p>
      )}
      {records.repBests.length > 0 && (
        <>
          <h2 className='list-label'>Heaviest weight by reps</h2>
          <table aria-label='Heaviest weight by reps'>
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
                    <button
                      className='text-action'
                      aria-label={`View source workout ${best.reps} reps ${dateLabel(best.date)}`}
                      onClick={() => onSource(best.workoutId)}
                    >
                      {dateLabel(best.date)} <ArrowUpRight size={13} />
                    </button>
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
  onExclude,
  backLabel = 'Back to exercises',
  renderTitle = (heading) => heading,
}: {
  dataset: Dataset;
  name: string;
  onBack: () => void;
  onSource: (id: string) => void;
  onExclude: ExcludeSetHandler;
  backLabel?: string;
  /** Lets a dialog host wrap the name heading as its accessible title. */
  renderTitle?: (heading: ReactElement) => ReactNode;
}) {
  // Unique workouts, matching the Exercises list; History/Charts/Records stay per exercise block.
  const workouts = exerciseWorkoutCount(dataset, name);
  const [tab, setTab] = useState<Tab>(workouts ? 'History' : 'About');
  // The library and the workout can both show details at once; ids must stay unique.
  const id = useId();
  return (
    <div className='exercise-detail'>
      <header className='detail-header'>
        <Button variant='ghost' size='icon' aria-label={backLabel} onClick={onBack}>
          <ArrowLeft size={20} />
        </Button>
        <ExerciseThumb name={name} />
        <div>
          {renderTitle(<h2>{name}</h2>)}
          <p>
            {bodyPartOf(name)} · {plural(workouts, 'workout')}
          </p>
        </div>
      </header>
      <div className='tabs' role='tablist' aria-label='Exercise sections'>
        {tabs.map((value) => (
          <button
            key={value}
            role='tab'
            id={`${id}-tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`${id}-panel`}
            className='tab'
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div role='tabpanel' id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
        {tab === 'About' && <About name={name} />}
        {tab === 'History' && (
          <HistoryTab dataset={dataset} name={name} onSource={onSource} onExclude={onExclude} />
        )}
        {tab === 'Charts' && (
          <ExerciseCharts key={name} dataset={dataset} name={name} onSource={onSource} />
        )}
        {tab === 'Records' && <RecordsTab dataset={dataset} name={name} onSource={onSource} />}
      </div>
    </div>
  );
}
