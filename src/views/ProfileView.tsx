import {useMemo} from 'react';

import {Card} from '../components/ui/card';
import {SectionHeading} from '../components/ui/section-heading';
import {workoutsPerWeek} from '../domain/model';
import {setCount} from '../domain/sets';
import type {Workout} from '../domain/types';
import {plural} from '../utils/plural';

const WEEKS = 12;

/** Strong-style dashboard: totals and workouts per week, nothing estimated. */
export function ProfileView({workouts}: {workouts: Workout[]}) {
  const weeks = useMemo(() => workoutsPerWeek(workouts, WEEKS), [workouts]);
  const max = Math.max(3, ...weeks.map((w) => w.count));
  const sets = useMemo(() => workouts.reduce((n, w) => n + setCount(w), 0), [workouts]);
  const first = workouts.at(-1)?.date.slice(0, 4);
  const thisWeek = weeks.at(-1)?.count ?? 0;
  const average = weeks.slice(0, -1).reduce((n, w) => n + w.count, 0) / (WEEKS - 1);
  const barWidth = 640 / WEEKS;
  return (
    <div className='profile-view'>
      <Card as='section'>
        <SectionHeading>
          <h2>Workouts per week</h2>
          <span>Last {WEEKS} weeks</span>
        </SectionHeading>
        <p className='profile-totals mt-1'>
          <span className='numeric'>{workouts.length}</span>
          {workouts.length === 1 ? ' workout' : ' workouts'} ·{' '}
          <span className='numeric'>{sets}</span>
          {sets === 1 ? ' set' : ' sets'} · <span className='numeric'>{thisWeek}</span> this week
        </p>
        <svg
          className='week-chart my-2 h-auto w-full'
          viewBox='0 0 700 190'
          role='img'
          aria-label={`Workouts per week for the last ${WEEKS} weeks. ${weeks
            .map((w) => `${w.start}: ${w.count}`)
            .join(', ')}.`}
        >
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line
                className='stroke-border'
                x1='40'
                x2='690'
                y1={160 - (v / max) * 140}
                y2={160 - (v / max) * 140}
              />
              <text
                className='fill-muted-foreground text-[13px]'
                x='30'
                y={164 - (v / max) * 140}
                textAnchor='end'
              >
                {Number(v.toFixed(1))}
              </text>
            </g>
          ))}
          {weeks.map((week, i) => {
            const height = (week.count / max) * 140;
            return (
              <g key={week.start}>
                <rect
                  x={48 + i * barWidth + barWidth * 0.18}
                  y={160 - height}
                  width={barWidth * 0.64}
                  height={height}
                  className={
                    i === weeks.length - 1
                      ? 'current-week fill-primary stroke-none [rx:0]'
                      : 'fill-[hsl(var(--chart-secondary))] stroke-[hsl(var(--chart-secondary-edge))] stroke-1 [rx:0]'
                  }
                >
                  <title>
                    Week of {week.start}: {plural(week.count, 'workout')}
                  </title>
                </rect>
                {i % 3 === WEEKS % 3 && (
                  <text
                    className='fill-muted-foreground text-[13px]'
                    x={48 + i * barWidth + barWidth / 2}
                    y='182'
                    textAnchor='middle'
                  >
                    {week.start.slice(5).replace('-', '/')}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <p className='text-[12px] text-muted-foreground'>
          {Number(average.toFixed(1))} per week on average before this week
          {first ? ` · logging since ${first}` : ''}.
        </p>
      </Card>
    </div>
  );
}
