import {ArrowUpRight, Search} from 'lucide-react';
import {useState} from 'react';

import {Button, Input} from '../components/ui';
import {getExercises, getHistory, getTrend} from '../domain/model';
import type {Dataset, Metric} from '../domain/types';
import {dateLabel} from './WorkoutView';

const labels: Record<Metric, string> = {
  load: 'Best load',
  reps: 'Best reps',
  e1rm: 'Estimated 1RM',
  volume: 'Session volume',
};
export function ProgressView({
  dataset,
  onSource,
}: {
  dataset: Dataset;
  onSource: (id: string) => void;
}) {
  const exercises = getExercises(dataset);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(
    exercises.find((name) => name.includes('Bench')) ?? exercises[0] ?? '',
  );
  const [metric, setMetric] = useState<Metric>('reps');
  const [range, setRange] = useState('all');
  const [sessionLimit, setSessionLimit] = useState(8);
  const matching = exercises.filter((name) => name.toLowerCase().includes(search.toLowerCase()));
  const name = exercises.includes(selected) ? selected : exercises[0];
  const history = getHistory(dataset, name);
  const type = history[0]?.type;
  const applicable =
    type === 'weighted'
      ? (['reps', 'load', 'e1rm', 'volume'] as Metric[])
      : type === 'assisted'
        ? (['reps', 'load'] as Metric[])
        : (['reps'] as Metric[]);
  const activeMetric = applicable.includes(metric) ? metric : applicable[0];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(range));
  const inRange = (date: string) =>
    range === 'all' || date.slice(0, 10) >= cutoff.toISOString().slice(0, 10);
  const points = getTrend(dataset, name, activeMetric).filter((p) => inRange(p.date));
  const sessions = history.filter((p) => inRange(p.date));
  const unit = activeMetric === 'reps' ? 'reps' : activeMetric === 'volume' ? 'kg·reps' : 'kg';
  const metricLabel =
    activeMetric === 'load' && type === 'assisted' ? 'Least assistance' : labels[activeMetric];
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || max * 0.15 || 1;
  const timestamps = points.map((point) => new Date(point.date).getTime());
  const firstTime = timestamps[0] ?? 0;
  const timeSpan = (timestamps.at(-1) ?? firstTime) - firstTime;
  const x = (i: number) => 54 + (timeSpan ? (timestamps[i] - firstTime) / timeSpan : 0.5) * 650;
  const y = (value: number) => 195 - ((value - min) / spread) * 135;
  return (
    <div className='progress-layout'>
      <aside className='exercise-picker'>
        <div className='search-input'>
          <Search size={15} />
          <Input
            aria-label='Search exercises'
            placeholder='Find an exercise…'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className='picker-label'>{matching.length} EXERCISES</span>
        <div className='exercise-options'>
          {matching.map((ex) => (
            <button
              key={ex}
              className={ex === name ? 'selected' : ''}
              onClick={() => {
                setSelected(ex);
                setMetric('reps');
                setSessionLimit(8);
              }}
            >
              {ex}
            </button>
          ))}
          {!matching.length && <p>No matching exercise.</p>}
        </div>
      </aside>
      <div className='progress-content'>
        <section className='analytics-card'>
          <div className='analytics-header'>
            <div>
              <span className='eyebrow'>EXERCISE RECORD</span>
              <h2>{name || 'No exercise history'}</h2>
              <p>
                {history.length} recorded sessions ·{' '}
                {type === 'assisted'
                  ? 'Assistance: less load is better'
                  : type === 'weighted'
                    ? 'Actual sets before estimates'
                    : type === 'bodyweight'
                      ? 'Unweighted work · rep history'
                      : 'Duration and distance in source sets below'}
              </p>
            </div>
            <select
              aria-label='Time range'
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              <option value='30'>Last 30 days</option>
              <option value='90'>Last 90 days</option>
              <option value='365'>Last year</option>
              <option value='all'>All time</option>
            </select>
          </div>
          <div className='metric-tabs' aria-label='Chart metric'>
            {applicable.map((m) => (
              <Button
                key={m}
                variant={m === activeMetric ? 'primary' : 'ghost'}
                aria-pressed={m === activeMetric}
                onClick={() => setMetric(m)}
              >
                {m === 'load' && type === 'assisted' ? 'Assistance (less is better)' : labels[m]}
              </Button>
            ))}
          </div>
          <div className='chart-caption'>
            <strong>{metricLabel}</strong>
            <span>
              {unit} per session{activeMetric !== 'volume' ? ' · best eligible set' : ''}
            </span>
          </div>
          {points.length ? (
            <svg
              className='trend-chart'
              viewBox='0 0 750 235'
              role='img'
              aria-label={`${metricLabel} for ${name}. ${points.length} sessions. Exact values in the table below.`}
            >
              <title>{metricLabel} over time</title>
              {[0, 0.5, 1].map((f, i) => {
                const value = min + spread * f;
                return (
                  <g key={i}>
                    <line
                      x1='54'
                      x2='704'
                      y1={y(value)}
                      y2={y(value)}
                      stroke='#e4e9e2'
                      strokeDasharray='4 5'
                    />
                    <text x='40' y={y(value) + 4} textAnchor='end'>
                      {Number(value.toFixed(1))}
                    </text>
                  </g>
                );
              })}
              <polyline
                points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
                fill='none'
                stroke='#245c46'
                strokeWidth='2.5'
                strokeLinejoin='round'
              />
              {points.map((p, i) => (
                <circle key={`${p.workoutId}-${i}`} cx={x(i)} cy={y(p.value)} r='4' fill='#245c46'>
                  <title>
                    {dateLabel(p.date)}: {Number(p.value.toFixed(2))} {unit}
                  </title>
                </circle>
              ))}
              <text x='54' y='226'>
                {dateLabel(points[0].date)}
              </text>
              <text x='704' y='226' textAnchor='end'>
                {dateLabel(points.at(-1)!.date)}
              </text>
            </svg>
          ) : (
            <div className='empty-chart'>
              <p>
                No eligible {activeMetric === 'reps' ? 'rep' : 'metric'} sets in this time range.
                Inspect source sets below.
              </p>
            </div>
          )}
          <p className='metric-explanation'>
            {activeMetric === 'e1rm'
              ? 'Epley estimate = weight × (1 + reps / 30), for 2–10 reps. One rep uses recorded weight. This is an estimate, not a tested maximum.'
              : activeMetric === 'volume'
                ? 'Recorded load × reps, summed per session. Not a measure of hypertrophy. Dumbbell load is per dumbbell.'
                : activeMetric === 'load' && type === 'assisted'
                  ? 'Lowest recorded assistance per session. Lower assistance means less help; no estimated strength or volume formula is applied.'
                  : activeMetric === 'load'
                    ? 'Highest recorded load per session; reps may differ. Machine loads are not comparable across different machines or gyms.'
                    : 'Highest recorded reps in a set per session. Weights may differ: compare the exact source sets below.'}
          </p>
          <div className='table-scroll'>
            <table aria-label='Exact trend values'>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>{metricLabel}</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point, i) => (
                  <tr key={`${point.workoutId}-${i}`}>
                    <td>{dateLabel(point.date)}</td>
                    <td>
                      {point.value} {unit}
                    </td>
                    <td>
                      <button
                        className='text-action'
                        aria-label={`View source workout ${dateLabel(point.date)}`}
                        onClick={() => onSource(point.workoutId)}
                      >
                        View sets <ArrowUpRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className='analytics-card source-sessions'>
          <div className='section-heading'>
            <h2>Every recorded set</h2>
            <span>{sessions.length} sessions</span>
          </div>
          {sessions.slice(0, sessionLimit).map((session, i) => (
            <article key={`${session.workoutId}-${i}`}>
              <header>
                <div>
                  <strong>{dateLabel(session.date)}</strong>
                  <p>{session.workoutName}</p>
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
              <div className='exact-sets'>
                {session.sets.map((set, j) => (
                  <span key={set.id}>
                    <b>{j + 1}</b>
                    {type === 'duration' || type === 'cardio'
                      ? `${set.seconds ?? '—'} s · ${set.distance ?? '—'} km`
                      : `${set.weight === null ? 'BW' : set.weight + ' kg'} × ${set.reps ?? '—'}`}
                    {set.suspicious ? ' · flagged' : ''}
                    {set.excluded ? ' · excluded' : ''}
                  </span>
                ))}
              </div>
            </article>
          ))}
          {sessions.length > sessionLimit && (
            <Button onClick={() => setSessionLimit((n) => n + 12)}>Show more source sets</Button>
          )}
        </section>
      </div>
    </div>
  );
}
