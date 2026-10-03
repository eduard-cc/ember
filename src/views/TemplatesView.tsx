import {Pencil, Play, Plus, Trash2, X} from 'lucide-react';
import {useState} from 'react';

import {Button, Input} from '../components/ui';
import {historyTargets} from '../components/workout-targets';
import {getExercises} from '../domain/model';
import type {Dataset, ExerciseType, Workout} from '../domain/types';
import {newWorkout} from '../state/workout';
import {WorkoutView} from './WorkoutView';

export function TemplatesView({
  templates,
  dataset,
  onChange,
  onStart,
}: {
  templates: Workout[];
  dataset: Dataset;
  onChange: (templates: Workout[], base?: Workout) => Promise<boolean>;
  onStart: (workout: Workout) => void;
}) {
  const [editing, setEditing] = useState<Workout | null>(null);
  const [editingBase, setEditingBase] = useState<Workout | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [exerciseName, setExerciseName] = useState('');
  const [exerciseType, setExerciseType] = useState<ExerciseType>('weighted');
  const add = () => {
    if (!editing || !exerciseName.trim()) return;
    const known = dataset.workouts
      .flatMap((w) => w.exercises)
      .find((ex) => ex.name === exerciseName.trim());
    const type = known?.type ?? exerciseType;
    setEditing({
      ...editing,
      exercises: [...editing.exercises, historyTargets(dataset, exerciseName.trim(), type)],
    });
    setExerciseName('');
  };
  return (
    <div className='templates-view'>
      <div className='list-toolbar'>
        <p>Routines · editable targets, not completed sets.</p>
        <Button
          variant='primary'
          onClick={() => {
            setEditingBase(undefined);
            setEditing(newWorkout());
            setExerciseName('');
          }}
        >
          <Plus size={16} /> Create template
        </Button>
      </div>
      {editing ? (
        <section className='template-editor'>
          <div className='section-heading'>
            <h2>
              {templates.some((t) => t.id === editing.id) ? 'Edit template' : 'Create a template'}
            </h2>
            <Button
              size='icon'
              variant='ghost'
              aria-label='Cancel template editing'
              onClick={() => setEditing(null)}
            >
              <X size={18} />
            </Button>
          </div>
          <label className='field-label' htmlFor='template-name'>
            Template name
          </label>
          <Input
            id='template-name'
            value={editing.name === 'Untitled workout' ? '' : editing.name}
            onChange={(e) => setEditing({...editing, name: e.target.value})}
            placeholder='e.g. Upper body B'
          />
          <div className='exercise-add-form'>
            <div>
              <label className='field-label' htmlFor='exercise-name'>
                Exercise name
              </label>
              <Input
                id='exercise-name'
                list='exercise-catalog'
                placeholder='Search or enter a custom exercise'
                value={exerciseName}
                onChange={(e) => {
                  setExerciseName(e.target.value);
                  const known = dataset.workouts
                    .flatMap((w) => w.exercises)
                    .find((ex) => ex.name === e.target.value);
                  if (known) setExerciseType(known.type);
                  else if (/assisted/i.test(e.target.value)) setExerciseType('assisted');
                  else setExerciseType('weighted');
                }}
              />
              <datalist id='exercise-catalog'>
                {getExercises(dataset).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className='field-label' htmlFor='exercise-type'>
                Type
              </label>
              <select
                id='exercise-type'
                value={exerciseType}
                onChange={(e) => setExerciseType(e.target.value as ExerciseType)}
              >
                <option value='weighted'>Weighted</option>
                <option value='assisted'>Assisted</option>
                <option value='bodyweight'>Bodyweight</option>
                <option value='duration'>Duration</option>
                <option value='cardio'>Cardio</option>
              </select>
            </div>
            <Button onClick={add} disabled={!exerciseName.trim()}>
              <Plus size={16} /> Add exercise
            </Button>
          </div>
          <WorkoutView
            targetsOnly
            workout={editing}
            dataset={dataset}
            onChange={setEditing}
            onSource={() => {}}
          />
          <div className='editor-footer'>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant='primary'
              disabled={
                !editing.name.trim() ||
                editing.name === 'Untitled workout' ||
                !editing.exercises.length
              }
              onClick={async () => {
                const clean = {
                  ...editing,
                  exercises: editing.exercises.map((ex) => ({
                    ...ex,
                    sets: ex.sets.map((s) => ({...s, completed: false})),
                  })),
                };
                const saved = await onChange(
                  templates.some((t) => t.id === clean.id)
                    ? templates.map((t) => (t.id === clean.id ? clean : t))
                    : [...templates, clean],
                  editingBase,
                );
                if (saved) setEditing(null);
              }}
            >
              Save template
            </Button>
          </div>
        </section>
      ) : (
        <div className='template-grid'>
          {templates.map((template) => (
            <article className='template-card' key={template.id}>
              <span className='eyebrow'>
                {template.exercises.length} EXERCISES ·{' '}
                {template.exercises.reduce((n, ex) => n + ex.sets.length, 0)} TARGET SETS
              </span>
              <h2>{template.name}</h2>
              <div className='template-exercises'>
                {template.exercises.map((ex, i) => (
                  <div key={`${ex.name}-${i}`}>
                    <span>{ex.name}</span>
                    <small>{ex.sets.length} sets</small>
                  </div>
                ))}
              </div>
              <footer>
                <Button
                  variant='primary'
                  aria-label={`Start template ${template.name}`}
                  onClick={() => onStart(template)}
                >
                  <Play size={14} /> Start workout
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={`Edit template ${template.name}`}
                  onClick={() => {
                    setEditingBase(structuredClone(template));
                    setEditing(structuredClone(template));
                  }}
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={`Delete template ${template.name}`}
                  onClick={() => setDeleteId(template.id)}
                >
                  <Trash2 size={16} />
                </Button>
              </footer>
              {deleteId === template.id && (
                <div className='inline-confirm'>
                  <p>Delete this template? Your workout history is kept.</p>
                  <Button onClick={() => setDeleteId(null)}>Cancel</Button>
                  <Button
                    variant='danger'
                    aria-label='Confirm delete template'
                    onClick={() => {
                      onChange(templates.filter((t) => t.id !== template.id));
                      setDeleteId(null);
                    }}
                  >
                    Delete template
                  </Button>
                </div>
              )}
            </article>
          ))}
          {!templates.length && (
            <div className='empty-state'>
              <h2>No templates yet</h2>
              <p>Create one, or save any historical workout as a template.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
