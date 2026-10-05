import {ChevronRight, Info, Settings} from 'lucide-react';
import {useMemo} from 'react';

import {Button, plural} from '../components/ui';
import {workoutsPerWeek} from '../domain/model';
import type {Workout} from '../domain/types';

const WEEKS = 12;

/** Strong-style dashboard: totals and workouts per week, nothing estimated. */
export function ProfileView({
  workouts,
  onSettings,
  onCredits,
}: {
  workouts: Workout[];
  onSettings: () => void;
  onCredits: () => void;
}) {
  const weeks = useMemo(() => workoutsPerWeek(workouts, WEEKS), [workouts]);
  const max = Math.max(3, ...weeks.map((w) => w.count));
  const sets = useMemo(
    () => workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0),
    [workouts],
  );
  const first = workouts.at(-1)?.date.slice(0, 4);
  const thisWeek = weeks.at(-1)?.count ?? 0;
  const average = weeks.slice(0, -1).reduce((n, w) => n + w.count, 0) / (WEEKS - 1);
  const barWidth = 640 / WEEKS;
  return (
    <div className='profile-view'>
      <section className='profile-stats' aria-label='Training totals'>
        <div>
          <strong>{workouts.length}</strong>
          <span>workouts</span>
        </div>
        <div>
          <strong>{sets}</strong>
          <span>sets</span>
        </div>
        <div>
          <strong>{thisWeek}</strong>
          <span>this week</span>
        </div>
      </section>
      <section className='analytics-card'>
        <div className='section-heading'>
          <h2>Workouts per week</h2>
          <span>Last {WEEKS} weeks</span>
        </div>
        <svg
          className='week-chart'
          viewBox='0 0 700 190'
          role='img'
          aria-label={`Workouts per week for the last ${WEEKS} weeks. ${weeks
            .map((w) => `${w.start}: ${w.count}`)
            .join(', ')}.`}
        >
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line x1='40' x2='690' y1={160 - (v / max) * 140} y2={160 - (v / max) * 140} />
              <text x='30' y={164 - (v / max) * 140} textAnchor='end'>
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
                  className={i === weeks.length - 1 ? 'current-week' : undefined}
                >
                  <title>
                    Week of {week.start}: {plural(week.count, 'workout')}
                  </title>
                </rect>
                {i % 3 === WEEKS % 3 && (
                  <text x={48 + i * barWidth + barWidth / 2} y='182' textAnchor='middle'>
                    {week.start.slice(5).replace('-', '/')}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <p className='chart-note'>
          {Number(average.toFixed(1))} per week on average before this week
          {first ? ` · logging since ${first}` : ''}.
        </p>
      </section>
      <nav className='profile-links' aria-label='Profile'>
        <Button variant='ghost' className='profile-link' onClick={onSettings}>
          <Settings size={18} /> Settings <ChevronRight size={16} />
        </Button>
        <Button variant='ghost' className='profile-link' onClick={onCredits}>
          <Info size={18} /> Credits and licenses <ChevronRight size={16} />
        </Button>
      </nav>
    </div>
  );
}
