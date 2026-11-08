import {Search, SearchX} from 'lucide-react';
import {useId, useMemo, useRef, useState} from 'react';

import {type BodyPart, allExerciseNames, bodyPartOf, bodyPartsOf} from '../catalog/catalog';
import {
  type ExerciseSort,
  exerciseStats,
  parseExerciseSort,
  sortExerciseNames,
} from '../domain/model';
import type {Dataset} from '../domain/types';
import {cn} from '../utils/cn';
import {plural} from '../utils/plural';
import {ExerciseThumb} from './ExerciseThumb';
import {ExerciseRowText, exerciseRowClass} from './exercise-row';
import {Button} from './ui/button';
import {Chip, ChipRow} from './ui/chip';
import {EmptyState} from './ui/empty-state';
import {Input} from './ui/input';
import {ListLabel} from './ui/list-label';

const sortKey = 'ember:exercise-sort:v1';
const sortOptions = [
  ['most', 'Most done'],
  ['az', 'A–Z'],
] as const satisfies readonly (readonly [ExerciseSort, string])[];
/** Library sort order: a device preference like appearance, never workout data. */
function useExerciseSort() {
  const [sort, setSort] = useState<ExerciseSort>(() => {
    try {
      return parseExerciseSort(localStorage.getItem(sortKey));
    } catch {
      return 'most';
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
  unavailable,
}: {
  name: string;
  sessions: number;
  onSelect: (name: string) => void;
  unavailable?: string;
}) {
  const id = useId();
  return (
    <li>
      <button
        className={exerciseRowClass}
        aria-label={name}
        aria-describedby={sessions || unavailable ? id : undefined}
        onClick={() => {
          onSelect(name);
        }}
      >
        <ExerciseThumb name={name} />
        <ExerciseRowText
          title={name}
          subtitle={
            <>
              {bodyPartOf(name)}
              {unavailable && <span className='block font-medium'>{unavailable}</span>}
            </>
          }
        />
        {sessions > 0 && (
          <span
            className='exercise-row-count ml-auto shrink-0 pr-2 pl-3 text-[16px] font-semibold text-primary tabular-nums'
            aria-hidden='true'
          >
            {sessions}
          </span>
        )}
        {(sessions > 0 || unavailable) && (
          <span id={id} className='sr-only'>
            {[sessions > 0 ? `Performed in ${plural(sessions, 'workout')}` : '', unavailable]
              .filter(Boolean)
              .join('. ')}
          </span>
        )}
      </button>
    </li>
  );
}

/** Catalog and recorded exercises: search, body-part filter, recent first, then everything most done or A–Z. */
export function ExerciseList({
  dataset,
  onSelect,
  sortable = false,
  existingNames = [],
  scope = 'workout',
  contained = false,
}: {
  dataset: Dataset;
  onSelect: (name: string) => void;
  /** Offer the persisted Most done / A–Z order (Exercises tab). The picker stays A–Z. */
  sortable?: boolean;
  existingNames?: string[];
  scope?: 'workout' | 'template';
  /** The full-screen picker keeps search/filters above its contained results. */
  contained?: boolean;
}) {
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const filtersChanged = () => {
    if (results.current) results.current.scrollTop = 0;
  };
  const [part, setPart] = useState<BodyPart | 'All'>('All');
  const names = useMemo(() => allExerciseNames(dataset), [dataset]);
  const parts = useMemo(() => bodyPartsOf(names), [names]);
  const stats = useMemo(() => exerciseStats(dataset), [dataset]);
  const [storedSort, setSort] = useExerciseSort();
  const sort = sortable ? storedSort : 'az';
  const ordered = useMemo(() => sortExerciseNames(names, stats, sort), [names, stats, sort]);
  const byRecency = useMemo(
    () =>
      [...stats.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([name]) => name),
    [stats],
  );
  const query = search.trim().toLowerCase();
  const filtered = search.length > 0 || part !== 'All';
  const matches = (name: string) =>
    (!query || name.toLowerCase().includes(query)) && (part === 'All' || bodyPartOf(name) === part);
  const recent = byRecency.filter(matches).slice(0, 6);
  const all = ordered.filter(matches);
  const clear = (className?: string) => (
    <Button
      variant='ghost'
      className={cn('shrink-0', className)}
      onClick={() => {
        setSearch('');
        setPart('All');
        filtersChanged();
        searchInput.current?.focus();
      }}
    >
      {/* One body part at a time; a search alongside it makes two. */}
      {query && part !== 'All' ? 'Clear filters' : 'Clear filter'}
    </Button>
  );
  return (
    <div className={cn('exercises-view', contained && 'flex min-h-0 flex-1 flex-col')}>
      <div className={cn('shrink-0', contained && 'px-[max(18px,calc((100vw-900px)/2))] pb-3')}>
        <div className='relative flex items-center'>
          <Search
            size={16}
            className='pointer-events-none absolute left-[13px] text-muted-foreground'
          />
          <Input
            ref={searchInput}
            type='search'
            className='pl-[38px]'
            aria-label='Search exercises'
            placeholder='Search exercises'
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              filtersChanged();
            }}
          />
        </div>
        {/* Clear joins the sort control under the chips; the picker has no sort, so it keeps
            Clear beside the chips rather than spending a row of its short landscape height. */}
        <div className='flex items-start gap-2'>
          <ChipRow role='group' aria-label='Body part' className='min-w-0 flex-1'>
            {(['All', ...parts] as const).map((value) => (
              <Chip
                key={value}
                aria-pressed={part === value}
                onClick={() => {
                  setPart(value);
                  filtersChanged();
                }}
              >
                {value}
              </Chip>
            ))}
          </ChipRow>
          {!sortable && filtered && clear('mt-3')}
        </div>
        {sortable && (
          <div className='mt-3 flex items-center justify-between gap-3'>
            <div
              className='inline-flex border border-border bg-card'
              role='group'
              aria-label='Sort exercises'
            >
              {sortOptions.map(([value, label]) => (
                <button
                  key={value}
                  className='min-h-11 min-w-16 border-0 bg-transparent px-3 text-xs font-medium text-muted-foreground not-first:border-l not-first:border-l-border hover:bg-accent aria-pressed:bg-secondary aria-pressed:font-semibold aria-pressed:text-secondary-foreground'
                  aria-pressed={sort === value}
                  onClick={() => {
                    setSort(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {filtered && clear()}
          </div>
        )}
      </div>
      <div
        ref={results}
        className={cn(
          'exercise-results',
          contained &&
            'min-h-0 flex-1 overflow-y-auto overscroll-contain px-[max(18px,calc((100vw-900px)/2))] pb-[max(24px,env(safe-area-inset-bottom))]',
        )}
      >
        {!query && part === 'All' && recent.length > 0 && (
          <section aria-label='Recent exercises'>
            <ListLabel>Recent</ListLabel>
            <ul>
              {recent.map((name) => (
                <ExerciseRow
                  key={name}
                  name={name}
                  sessions={stats.get(name)?.sessions ?? 0}
                  onSelect={onSelect}
                  unavailable={existingNames.includes(name) ? `Already in ${scope}` : undefined}
                />
              ))}
            </ul>
          </section>
        )}
        <section aria-label='All exercises'>
          <ListLabel>
            {filtered
              ? `${all.length} of ${names.length} exercises`
              : plural(all.length, 'exercise')}
          </ListLabel>
          <ul>
            {all.map((name) => (
              <ExerciseRow
                key={name}
                name={name}
                sessions={stats.get(name)?.sessions ?? 0}
                onSelect={onSelect}
                unavailable={existingNames.includes(name) ? `Already in ${scope}` : undefined}
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
    </div>
  );
}
