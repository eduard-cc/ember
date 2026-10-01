import { useEffect, useState } from 'react';
import type { Dataset, Workout } from '../domain/types';
import { demoTemplates } from '../domain/demo';
const KEY = 'gym-log:v1';
export function newWorkout(workout?: Workout): Workout {
  const now = new Date();
  const localTimestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  return { id: crypto.randomUUID(), name: workout?.name ?? 'Untitled workout', date: localTimestamp, duration: 0, exercises: workout?.exercises.map(ex => ({ ...ex, sets: ex.sets.map(set => ({ ...set, id: crypto.randomUUID(), completed: false })) })) ?? [] };
}
const initialWorkout = demoTemplates[0];
export interface AppState { version: 1; dataset: Dataset | null; active: Workout | null; finished: Workout[]; templates: Workout[] | null }
export function useWorkoutState() {
  const [error, setError] = useState('');
  const [loaded] = useState(() => {
    const fresh: AppState = { version: 1, dataset: null, active: { ...newWorkout(initialWorkout), id: `demo-draft-${crypto.randomUUID()}` }, finished: [], templates: null };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) return { state: fresh, recoveryError: '' };
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !Array.isArray(parsed.finished) || (parsed.active && !Array.isArray(parsed.active.exercises))) throw new Error('Unsupported saved data');
      return { state: parsed as AppState, recoveryError: '' };
    } catch {
      return { state: fresh, recoveryError: 'Saved data could not be read. The original has been left untouched. Changes in this tab are only in memory until you explicitly reset the unreadable saved data.' };
    }
  });
  const [state, setState] = useState<AppState>(loaded.state);
  const [recoveryError, setRecoveryError] = useState(loaded.recoveryError);
  useEffect(() => {
    if (recoveryError) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); setError(''); } catch { setError('Could not save on this device. Keep this tab open; your changes are only in memory.'); }
  }, [state, recoveryError]);
  const resetUnreadableStorage = () => {
    if (window.confirm('Replace the unreadable saved data with the current contents of this tab? The original saved data will be permanently lost. Cancel if you want to recover it first.')) setRecoveryError('');
  };
  return { state, setState, recoveryError, resetUnreadableStorage, persistenceError: recoveryError || error };
}
