import {ClipboardList, Pencil, Plus, Trash2, X} from 'lucide-react';
import {useState} from 'react';

import {bodyPartOf} from '../catalog/catalog';
import {AddExercise} from '../components/AddExercise';
import {ExerciseThumb} from '../components/ExerciseThumb';
import {ExerciseRowText, exerciseRowClass} from '../components/exercise-row';
import {Button} from '../components/ui/button';
import {Card} from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogCornerClose,
  DialogDescription,
  DialogTitle,
} from '../components/ui/dialog';
import {EmptyState} from '../components/ui/empty-state';
import {fieldLabelClass} from '../components/ui/field-label';
import {Input} from '../components/ui/input';
import {SectionHeading} from '../components/ui/section-heading';
import type {Dataset, Workout} from '../domain/types';
import {useBackLayer} from '../state/back';
import {newWorkout} from '../state/workout';
import {plural} from '../utils/plural';
import {WorkoutView, dateLabel} from './WorkoutView';

/** Latest finished session with the template's exact name, if any. */
function lastPerformed(dataset: Dataset, name: string): string | undefined {
  return dataset.workouts.find((w) => w.name === name)?.date;
}

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
  const [deletingSets, setDeletingSets] = useState(false);
  const [editingBase, setEditingBase] = useState<Workout | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Workout | null>(null);
  useBackLayer(!!editing, () => setEditing(null));
  useBackLayer(!!preview, () => setPreview(null));
  return (
    <div className='templates-view'>
      <SectionHeading className='templates-heading mt-7'>
        <h2>My templates</h2>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Create template'
          onClick={() => {
            setEditingBase(undefined);
            setEditing(newWorkout());
          }}
        >
          <Plus size={20} />
        </Button>
      </SectionHeading>
      {editing ? (
        <Card as='section' className='template-editor'>
          <SectionHeading>
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
          </SectionHeading>
          <label className={fieldLabelClass} htmlFor='template-name'>
            Template name
          </label>
          <Input
            id='template-name'
            value={editing.name === 'Untitled workout' ? '' : editing.name}
            onChange={(e) => setEditing({...editing, name: e.target.value})}
            placeholder='e.g. Upper body B'
          />
          <AddExercise
            dataset={dataset}
            existingNames={editing.exercises.map((exercise) => exercise.name)}
            onAdd={(exercise) =>
              setEditing(
                (current) => current && {...current, exercises: [...current.exercises, exercise]},
              )
            }
          />
          <WorkoutView
            targetsOnly
            workout={editing}
            dataset={dataset}
            onChange={(update) =>
              setEditing(
                (current) => current && (typeof update === 'function' ? update(current) : update),
              )
            }
            onDeletingChange={setDeletingSets}
            onSource={() => {}}
          />
          <div className='mt-[18px] flex flex-wrap justify-end gap-2.5 border-t border-border pt-5'>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant='primary'
              disabled={
                deletingSets ||
                !editing.name.trim() ||
                editing.name === 'Untitled workout' ||
                !editing.exercises.length
              }
              onClick={async () => {
                if (deletingSets) return;
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
        </Card>
      ) : (
        <>
          {!!templates.length && (
            <div className='template-grid grid grid-cols-1 gap-0 border border-border bg-card desk:grid-cols-2 desk:logger-open:grid-cols-1'>
              {templates.map((template) => {
                const last = lastPerformed(dataset, template.name);
                return (
                  <article
                    className='template-card flex min-w-0 flex-col self-stretch border-0 border-t border-border first:border-t-0 desk:last:odd:col-span-full desk:even:border-l desk:nth-2:border-t-0 desk:logger-open:last:odd:col-auto desk:logger-open:even:border-l-0 desk:logger-open:nth-2:border-t'
                    key={template.id}
                  >
                    <header className='flex items-center gap-0.5 pt-1.5 pr-1.5 pl-4'>
                      <h3 className='min-w-0 flex-1 truncate text-[16px] font-semibold'>
                        {template.name}
                      </h3>
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
                    </header>
                    <button
                      className='template-open min-h-11 border-0 bg-transparent px-4 pt-1 pb-3.5 text-left text-inherit [font:inherit]'
                      aria-label={`Open template ${template.name}`}
                      onClick={() => setPreview(template)}
                    >
                      <ul className='mb-2 list-none p-0 text-[14px] leading-[1.6] text-muted-foreground'>
                        {template.exercises.slice(0, 6).map((ex, i) => (
                          <li className='[overflow-wrap:anywhere]' key={`${ex.name}-${i}`}>
                            {ex.sets.length} × {ex.name}
                          </li>
                        ))}
                        {template.exercises.length > 6 && (
                          <li className='[overflow-wrap:anywhere]'>
                            + {plural(template.exercises.length - 6, 'more exercise')}
                          </li>
                        )}
                      </ul>
                      <small className='text-[12px] text-muted-foreground'>
                        {last ? `Last performed ${dateLabel(last)}` : 'Not performed yet'}
                      </small>
                    </button>
                    {deleteId === template.id && (
                      <div className='inline-confirm mt-4 border-t border-border px-4 pb-3.5'>
                        <p className='mb-2.5'>
                          Delete this template? Your workout history is kept.
                        </p>
                        <Button className='mr-2' onClick={() => setDeleteId(null)}>
                          Cancel
                        </Button>
                        <Button
                          variant='danger'
                          className='mr-2'
                          aria-label='Confirm delete template'
                          onClick={() => {
                            void onChange(templates.filter((t) => t.id !== template.id));
                            setDeleteId(null);
                          }}
                        >
                          Delete template
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {!templates.length && (
            <EmptyState
              icon={ClipboardList}
              title='No templates yet'
              description='Create one, or save any finished workout as a template from History.'
            />
          )}
        </>
      )}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className='template-preview'>
          <DialogTitle className='pr-7'>{preview?.name}</DialogTitle>
          <DialogDescription>
            {preview && lastPerformed(dataset, preview.name)
              ? `Last performed ${dateLabel(lastPerformed(dataset, preview.name)!)}`
              : 'Not performed yet'}
          </DialogDescription>
          <ul className='mt-3.5 mb-4.5'>
            {preview?.exercises.map((ex, i) => (
              <li key={`${ex.name}-${i}`} className={exerciseRowClass}>
                <ExerciseThumb name={ex.name} />
                <ExerciseRowText
                  title={`${ex.sets.length} × ${ex.name}`}
                  subtitle={bodyPartOf(ex.name)}
                />
              </li>
            ))}
          </ul>
          <Button
            variant='primary'
            className='min-h-12 w-full'
            aria-label={`Start template ${preview?.name ?? ''}`}
            onClick={() => {
              if (preview) onStart(preview);
              setPreview(null);
            }}
          >
            Start workout
          </Button>
          <DialogCornerClose label='Close' />
        </DialogContent>
      </Dialog>
    </div>
  );
}
