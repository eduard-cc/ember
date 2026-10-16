import {Search} from 'lucide-react';
import {type ReactNode, useId, useMemo, useState} from 'react';

import {type BodyPart, allExerciseNames, bodyPartOf, bodyParts} from '../catalog/catalog';
import {
  type ExerciseSort,
  exerciseStats,
  parseExerciseSort,
  sortExerciseNames,
} from '../domain/model';
import type {Dataset} from '../domain/types';
import {plural} from '../utils/plural';
import {ExerciseThumb} from './ExerciseThumb';
import {Input} from './ui/input';

const sortKey = 'gym-log:exercise-sort:v1';
const sortOptions = [
  ['az', 'A–Z'],
  ['most', 'Most done'],
] as const satisfies readonly (readonly [ExerciseSort, string])[];
/** Library sort order: a device preference like appearance, never workout data. */
function useExerciseSort() {
  const [sort, setSort] = useState<ExerciseSort>(() => {
    try {
      return parseExerciseSort(localStorage.getItem(sortKey));
    } catch {
      return 'az';
    }
  });
  const choose = (next: ExerciseSort) => {
    setSort(next);
    try {
      localStorage.setItem(sortKey, next);
    } catch {
      /* The choice still applies for this tab. */
    }
  };
  return [sort, choose] as const;
}

function ExerciseRow({
  name,
  sessions,
  onSelect,
}: {
  name: string;
  sessions: number;
  onSelect: (name: string) => void;
}) {
  const id = useId();
  return (
    <li>
      <button
        className='exercise-row'
        aria-label={name}
        aria-describedby={sessions ? id : undefined}
        onClick={() => onSelect(name)}
      >
        <ExerciseThumb name={name} />
        <span className='exercise-row-text'>
          <strong>{name}</strong>
          <small>{bodyPartOf(name)}</small>
        </span>
        {sessions > 0 && (
          <>
            <span className='exercise-row-count' aria-hidden='true'>
              {sessions}
            </span>
            <span id={id} className='sr-only'>
              Performed in {plural(sessions, 'workout')}
            </span>
          </>
        )}
      </button>
    </li>
  );
}

/** Catalog and recorded exercises: search, body-part filter, recent first, then everything A–Z or most done. */
export function ExerciseList({
  dataset,
  onSelect,
  extra,
  sortable = false,
}: {
  dataset: Dataset;
  onSelect: (name: string) => void;
  /** Offer the persisted A–Z / Most done order (Exercises tab). The picker stays A–Z. */
  sortable?: boolean;
  /** Rendered above the results for the current query, e.g. a custom-exercise row. */
  extra?: (query: string, names: string[]) => ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [part, setPart] = useState<BodyPart | 'All'>('All');
  const names = useMemo(() => allExerciseNames(dataset), [dataset]);
  const stats = useMemo(() => exerciseStats(dataset), [dataset]);
  const [storedSort, setSort] = useExerciseSort();
  const sort = sortable ? storedSort : 'az';
  const ordered = useMemo(() => sortExerciseNames(names, stats, sort), [names, stats, sort]);
  const query = search.trim().toLowerCase();
  const matches = (name: string) =>
    (!query || name.toLowerCase().includes(query)) && (part === 'All' || bodyPartOf(name) === part);
  const recent = [...stats.entries()]
    .sort((a, b) => b[1].last.localeCompare(a[1].last))
    .map(([name]) => name)
    .filter(matches)
    .slice(0, 6);
  const all = ordered.filter(matches);
  return (
    <div className='exercises-view'>
      <div className='search-input'>
        <Search size={16} />
        <Input
          aria-label='Search exercises'
          placeholder='Search exercises'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className='chip-row' role='group' aria-label='Body part'>
        {(['All', ...bodyParts] as const).map((value) => (
          <button
            key={value}
            className='chip'
            aria-pressed={part === value}
            onClick={() => setPart(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {sortable && (
        <div className='sort-toggle' role='group' aria-label='Sort exercises'>
          {sortOptions.map(([value, label]) => (
            <button key={value} aria-pressed={sort === value} onClick={() => setSort(value)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {extra?.(search.trim(), names)}
      {!query && part === 'All' && recent.length > 0 && (
        <section aria-label='Recent exercises'>
          <h2 className='list-label'>Recent</h2>
          <ul className='exercise-rows'>
            {recent.map((name) => (
              <ExerciseRow
                key={name}
                name={name}
                sessions={stats.get(name)?.sessions ?? 0}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      )}
      <section aria-label='All exercises'>
        <h2 className='list-label'>{plural(all.length, 'exercise')}</h2>
        <ul className='exercise-rows'>
          {all.map((name) => (
            <ExerciseRow
              key={name}
              name={name}
              sessions={stats.get(name)?.sessions ?? 0}
              onSelect={onSelect}
            />
          ))}
        </ul>
        {!all.length && <p className='empty-state'>No matching exercise.</p>}
      </section>
    </div>
  );
}
