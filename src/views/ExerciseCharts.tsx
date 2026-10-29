import {ArrowUpRight, LineChart} from 'lucide-react';
import {useMemo, useState} from 'react';

import {Button} from '../components/ui/button';
import {cardClass} from '../components/ui/card';
import {
  EmptyChart,
  MetricExplanation,
  trendChartClass,
  useElementWidth,
} from '../components/ui/chart';
import {TextAction, dataTableClass} from '../components/ui/data-table';
import {EmptyState} from '../components/ui/empty-state';
import {getHistory, getTrend} from '../domain/model';
import type {Dataset, Metric} from '../domain/types';
import {dateLabel} from '../utils/date';
import {plural} from '../utils/plural';

const labels: Record<Metric, string> = {
  load: 'Best load',
  reps: 'Best reps',
  e1rm: 'Estimated 1RM',
  volume: 'Session volume',
};

/** UTC day `days` ago, the first day a ranged chart shows. */
function since(days: string) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(days));
  return cutoff.toISOString().slice(0, 10);
}

/** Per-session trend for one exercise. Every point is listed with its source workout. */
export function ExerciseCharts({
  dataset,
  name,
  onSource,
  framed = true,
}: {
  dataset: Dataset;
  name: string;
  onSource: (id: string) => void;
  /** False inside a dialog, which already is a surface. */
  framed?: boolean;
}) {
  const [containerRef, chartWidth] = useElementWidth(750);
  const plotLeft = 54;
  const plotRight = chartWidth - 46;
  // The library stays mounted beside the logger: rescan history only when it changes.
  const history = useMemo(() => getHistory(dataset, name), [dataset, name]);
  const type = history[0]?.type;
  const applicable =
    type === 'weighted'
      ? (['reps', 'load', 'volume', 'e1rm'] as Metric[])
      : type === 'assisted'
        ? (['reps', 'load'] as Metric[])
        : (['reps'] as Metric[]);
  const [metric, setMetric] = useState<Metric>(applicable[0]);
  const [range, setRange] = useState('all');
  const activeMetric = applicable.includes(metric) ? metric : applicable[0];
  const trend = useMemo(() => getTrend(dataset, name, activeMetric), [dataset, name, activeMetric]);
  const first = range === 'all' ? null : since(range);
  const points = first ? trend.filter((p) => p.date.slice(0, 10) >= first) : trend;
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
  const x = (i: number) =>
    plotLeft + (timeSpan ? (timestamps[i] - firstTime) / timeSpan : 0.5) * (plotRight - plotLeft);
  const y = (value: number) => 195 - ((value - min) / spread) * 135;
  if (!history.length)
    return (
      <EmptyState
        icon={LineChart}
        title='No history yet'
        description='Charts appear after you log this exercise.'
        framed={framed}
      />
    );
  return (
    <section className={cardClass} ref={containerRef}>
      {/* `[align-items:start]` matches main's computed `start`; `items-start` computes `flex-start`. */}
      <div className='flex [align-items:start] justify-between gap-4 max-desk:flex-wrap'>
        <div
          className='mt-5 flex flex-wrap gap-[5px] border-b border-border pb-4'
          aria-label='Chart metric'
        >
          {applicable.map((m) => (
            <Button
              key={m}
              variant={m === activeMetric ? 'primary' : 'ghost'}
              className='px-2.5 text-[12px] leading-normal'
              aria-pressed={m === activeMetric}
              onClick={() => setMetric(m)}
            >
              {m === 'load' && type === 'assisted' ? 'Assistance (less is better)' : labels[m]}
            </Button>
          ))}
        </div>
        <select
          className='min-h-11 w-[130px] min-w-0 shrink-0 rounded-none border border-border bg-card px-3 py-[9px] text-[16px]'
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
      <div className='mt-3 mb-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1'>
        <strong className='text-[14px]'>{metricLabel}</strong>
        <span className='text-[12px] text-muted-foreground'>
          {unit} per session{activeMetric !== 'volume' ? ' · best eligible set' : ''}
        </span>
      </div>
      {points.length ? (
        <svg
          className={trendChartClass}
          viewBox={`0 0 ${chartWidth} 235`}
          role='img'
          aria-label={`${metricLabel} for ${name}. ${plural(points.length, 'session')}. Exact values in the table below.`}
        >
          <title>{metricLabel} over time</title>
          {[0, 0.5, 1].map((f, i) => {
            const value = min + spread * f;
            return (
              <g key={i}>
                <line
                  x1={plotLeft}
                  x2={plotRight}
                  y1={y(value)}
                  y2={y(value)}
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
            strokeWidth='2.5'
            strokeLinejoin='round'
          />
          {points.map((p, i) => (
            <circle key={`${p.workoutId}-${i}`} cx={x(i)} cy={y(p.value)} r='4'>
              <title>
                {dateLabel(p.date)}: {Number(p.value.toFixed(2))} {unit}
              </title>
            </circle>
          ))}
          <text x={plotLeft} y='226'>
            {dateLabel(points[0].date)}
          </text>
          <text x={plotRight} y='226' textAnchor='end'>
            {dateLabel(points.at(-1)!.date)}
          </text>
        </svg>
      ) : (
        <EmptyChart>
          <p>No eligible sets in this time range.</p>
        </EmptyChart>
      )}
      <MetricExplanation>
        {activeMetric === 'e1rm'
          ? 'Epley estimate = weight × (1 + reps / 30), for 1–10 reps. One rep uses recorded weight. This is an estimate, not a tested maximum.'
          : activeMetric === 'volume'
            ? 'Recorded load × reps, summed per session. Not a measure of hypertrophy. Dumbbell load is per dumbbell.'
            : activeMetric === 'load' && type === 'assisted'
              ? 'Lowest recorded assistance per session. Lower assistance means less help; no estimated strength or volume formula is applied.'
              : activeMetric === 'load'
                ? 'Highest recorded load per session; reps may differ. Machine loads are not comparable across different machines or gyms.'
                : 'Highest recorded reps in a set per session. Weights may differ: compare the exact source sets.'}
      </MetricExplanation>
      <div className='mt-5 max-h-[340px] w-full overflow-auto'>
        <table className={dataTableClass} aria-label='Exact trend values'>
          <thead>
            <tr>
              <th>Date</th>
              <th>{metricLabel}</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((point, i) => (
              <tr key={`${point.workoutId}-${i}`}>
                <td>{dateLabel(point.date)}</td>
                <td>
                  {Number(point.value.toFixed(2))} {unit}
                </td>
                <td>
                  <TextAction
                    aria-label={`View source workout ${dateLabel(point.date)}`}
                    onClick={() => onSource(point.workoutId)}
                  >
                    View sets <ArrowUpRight size={13} />
                  </TextAction>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
