import {Plus, X} from 'lucide-react';
import {useState} from 'react';

import {allExerciseNames, exerciseTypeFor} from '../catalog/catalog';
import type {Dataset, ExerciseLog, ExerciseType} from '../domain/types';
import {Button, Input} from './ui';
import {historyTargets} from './workout-targets';

export function AddExercise({
  dataset,
  onAdd,
}: {
  dataset: Dataset;
  onAdd: (exercise: ExerciseLog) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ExerciseType>('weighted');
  if (!open)
    return (
      <Button className='add-exercise-button' onClick={() => setOpen(true)}>
        <Plus size={16} /> Add exercise
      </Button>
    );
  return (
    <section className='exercise-adder'>
      <div className='section-heading'>
        <h2>Add an exercise</h2>
        <Button
          size='icon'
          variant='ghost'
          aria-label='Cancel adding exercise'
          onClick={() => setOpen(false)}
        >
          <X size={17} />
        </Button>
      </div>
      <label className='field-label' htmlFor='active-exercise-name'>
        Exercise name
      </label>
      <Input
        id='active-exercise-name'
        list='active-exercises'
        value={name}
        placeholder='Search or enter a custom exercise'
        onChange={(e) => {
          setName(e.target.value);
          const known = exerciseTypeFor(e.target.value, dataset);
          if (known) setType(known);
        }}
      />
      <datalist id='active-exercises'>
        {allExerciseNames(dataset).map((name) => (
          <option value={name} key={name} />
        ))}
      </datalist>
      <label className='field-label' htmlFor='active-exercise-type'>
        Exercise type
      </label>
      <select
        id='active-exercise-type'
        value={type}
        onChange={(e) => setType(e.target.value as ExerciseType)}
      >
        <option value='weighted'>Weighted</option>
        <option value='assisted'>Assisted</option>
        <option value='bodyweight'>Bodyweight</option>
        <option value='duration'>Duration</option>
        <option value='cardio'>Cardio</option>
      </select>
      <Button
        variant='primary'
        className='adder-save'
        disabled={!name.trim()}
        onClick={() => {
          onAdd(historyTargets(dataset, name.trim(), type));
          setOpen(false);
          setName('');
        }}
      >
        Add to workout
      </Button>
    </section>
  );
}
