import { useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import type { Workout } from '../domain/types';
import { Button, Input } from '../components/ui';
import { dateLabel } from './WorkoutView';
export function WorkoutDetails({ workout }: { workout: Workout }) {
  return <div className="workout-details">{workout.exercises.map((ex, i) => <section key={`${ex.name}-${i}`}><h3>{ex.name}</h3><div className="recorded-sets">{ex.sets.map((set, j) => <span key={set.id} className={set.suspicious ? 'suspicious-set' : ''}>Set {j+1}: {ex.type === 'duration' || ex.type === 'cardio' ? `${set.seconds ?? '—'} seconds${set.distance !== null ? ` · ${set.distance} km` : ''}` : `${set.weight === null ? 'Bodyweight' : `${set.weight} kg${ex.type === 'assisted' ? ' assistance' : ''}`} × ${set.reps ?? '—'} reps`}{set.suspicious ? ' · review flagged' : ''}{set.excluded ? ' · excluded' : ''}</span>)}</div></section>)}</div>;
}
export function HistoryView({ workouts, focusedId, onRepeat, onTemplate }: { workouts: Workout[]; focusedId: string | null; onRepeat: (workout: Workout) => void; onTemplate: (workout: Workout) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(20);
  const filtered = workouts.filter(w => !search || `${w.name} ${w.date} ${w.exercises.map(x => x.name).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const ordered = focusedId ? [...filtered].sort((a,b) => a.id === focusedId ? -1 : b.id === focusedId ? 1 : b.date.localeCompare(a.date)) : filtered;
  return <div className="history-list"><div className="list-toolbar"><Input aria-label="Search workout history" placeholder="Search workouts, exercises or dates…" value={search} onChange={e => { setSearch(e.target.value); setLimit(20); }} /><span>{filtered.length} sessions</span></div>{ordered.slice(0,limit).map(workout => {
    const open = expanded === workout.id || focusedId === workout.id;
    const count = workout.exercises.reduce((n,ex) => n+ex.sets.length,0);
    return <article className={`history-card ${focusedId === workout.id ? 'focused-history' : ''}`} key={workout.id}><div className="history-card-top"><div><span className="eyebrow">{dateLabel(workout.date)}{workout.duration ? ` · ${workout.duration} MIN` : ''}</span><h2>{workout.name}</h2><p>{count} completed set{count !== 1 ? 's' : ''}</p><p className="exercise-preview">{workout.exercises.map(ex => ex.name).join(' · ')}</p></div><Button size="icon" variant="ghost" aria-label={`View sets for ${workout.name} ${dateLabel(workout.date)}`} aria-expanded={open} onClick={() => setExpanded(open ? null : workout.id)}>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</Button></div>{open && <WorkoutDetails workout={workout} />}<footer><Button aria-label={`Repeat workout ${workout.name} ${dateLabel(workout.date)}`} onClick={() => onRepeat(workout)}><RotateCcw size={15} /> Repeat workout</Button><Button variant="ghost" onClick={() => onTemplate(workout)}>Save as template <ArrowUpRight size={15} /></Button></footer></article>;
  })}{filtered.length > limit && <Button onClick={() => setLimit(n => n+20)}>Show more sessions</Button>}{!filtered.length && <div className="empty-state"><h2>No matching workouts</h2><p>Try another search or finish your first workout.</p></div>}</div>;
}
