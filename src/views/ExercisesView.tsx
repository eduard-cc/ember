import {Search} from 'lucide-react';
import {useMemo, useState} from 'react';

import {type BodyPart, allExerciseNames, bodyPartOf, bodyParts} from '../catalog/catalog';
import {ExerciseThumb} from '../components/ExerciseThumb';
import {Input, plural} from '../components/ui';
import type {Dataset} from '../domain/types';

function ExerciseRow({
  name,
  sessions,
  onOpen,
}: {
  name: string;
  sessions: number;
  onOpen: (name: string) => void;
}) {
  return (
    <li>
      <button className='exercise-row' aria-label={name} onClick={() => onOpen(name)}>
        <ExerciseThumb name={name} />
        <span className='exercise-row-text'>
          <strong>{name}</strong>
          <small>
            {bodyPartOf(name)}
            {sessions ? ` · ${plural(sessions, 'session')}` : ''}
          </small>
        </span>
      </button>
    </li>
  );
}

/** Library of catalog and recorded exercises: recent first, then everything A–Z. */
export function ExercisesView({
  dataset,
  onOpen,
}: {
  dataset: Dataset;
  onOpen: (name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [part, setPart] = useState<BodyPart | 'All'>('All');
  const names = useMemo(() => allExerciseNames(dataset), [dataset]);
  const stats = useMemo(() => {
    const seen = new Map<string, {sessions: number; last: string}>();
    for (const workout of dataset.workouts)
      for (const exercise of workout.exercises) {
        const current = seen.get(exercise.name);
        if (!current) seen.set(exercise.name, {sessions: 1, last: workout.date});
        else {
          current.sessions++;
          if (workout.date > current.last) current.last = workout.date;
        }
      }
    return seen;
  }, [dataset]);
  const query = search.trim().toLowerCase();
  const matches = (name: string) =>
    (!query || name.toLowerCase().includes(query)) && (part === 'All' || bodyPartOf(name) === part);
  const recent = [...stats.entries()]
    .sort((a, b) => b[1].last.localeCompare(a[1].last))
    .map(([name]) => name)
    .filter(matches)
    .slice(0, 6);
  const all = names.filter(matches);
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
      {!query && part === 'All' && recent.length > 0 && (
        <section aria-label='Recent exercises'>
          <h2 className='list-label'>Recent</h2>
          <ul className='exercise-rows'>
            {recent.map((name) => (
              <ExerciseRow
                key={name}
                name={name}
                sessions={stats.get(name)?.sessions ?? 0}
                onOpen={onOpen}
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
              onOpen={onOpen}
            />
          ))}
        </ul>
        {!all.length && <p className='empty-state'>No matching exercise.</p>}
      </section>
    </div>
  );
}
