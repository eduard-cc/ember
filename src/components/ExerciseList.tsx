import {Search, SearchX} from 'lucide-react';
import {useId, useMemo, useState} from 'react';

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
import {ExerciseRowText, exerciseRowClass} from './exercise-row';
import {Chip, ChipRow} from './ui/chip';
import {EmptyState} from './ui/empty-state';
import {Input} from './ui/input';
import {ListLabel} from './ui/list-label';

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
        className={exerciseRowClass}
        aria-label={name}
        aria-describedby={sessions ? id : undefined}
        onClick={() => onSelect(name)}
      >
        <ExerciseThumb name={name} />
        <ExerciseRowText title={name} subtitle={bodyPartOf(name)} />
        {sessions > 0 && (
          <>
            <span
              className='exercise-row-count ml-auto shrink-0 pr-2 pl-3 text-[16px] font-semibold text-primary tabular-nums'
              aria-hidden='true'
            >
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
  sortable = false,
  labelClassName,
}: {
  dataset: Dataset;
  onSelect: (name: string) => void;
  /** Offer the persisted A–Z / Most done order (Exercises tab). The picker stays A–Z. */
  sortable?: boolean;
  /** Extra classes for the "Recent" and count labels. */
  labelClassName?: string;
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
      <div className='relative flex items-center'>
        <Search
          size={16}
          className='pointer-events-none absolute left-[13px] text-muted-foreground'
        />
        <Input
          className='pl-[38px]'
          aria-label='Search exercises'
          placeholder='Search exercises'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ChipRow role='group' aria-label='Body part'>
        {(['All', ...bodyParts] as const).map((value) => (
          <Chip key={value} aria-pressed={part === value} onClick={() => setPart(value)}>
            {value}
          </Chip>
        ))}
      </ChipRow>
      {sortable && (
        <div
          className='mt-3 inline-flex border border-border bg-card'
          role='group'
          aria-label='Sort exercises'
        >
          {sortOptions.map(([value, label]) => (
            <button
              key={value}
              className='min-h-11 min-w-16 border-0 bg-transparent px-4 text-[14px] font-medium text-muted-foreground not-first:border-l not-first:border-l-border aria-pressed:bg-primary-tint aria-pressed:font-semibold aria-pressed:text-primary aria-pressed:shadow-[inset_0_0_0_1px_hsl(var(--primary))]'
              aria-pressed={sort === value}
              onClick={() => setSort(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!query && part === 'All' && recent.length > 0 && (
        <section aria-label='Recent exercises'>
          <ListLabel className={labelClassName}>Recent</ListLabel>
          <ul>
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
        <ListLabel className={labelClassName}>{plural(all.length, 'exercise')}</ListLabel>
        <ul>
          {all.map((name) => (
            <ExerciseRow
              key={name}
              name={name}
              sessions={stats.get(name)?.sessions ?? 0}
              onSelect={onSelect}
            />
          ))}
        </ul>
        {/* Always unframed: the list sits in the picker dialog and on the Exercises tab alike. */}
        {!all.length && (
          <EmptyState
            icon={SearchX}
            title='No matching exercise'
            description='Try another name or clear the filters.'
            framed={false}
          />
        )}
      </section>
    </div>
  );
}
