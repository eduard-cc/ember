import * as Dialog from '@radix-ui/react-dialog';
import {Pencil, Plus, Trash2, X} from 'lucide-react';
import {useState} from 'react';

import {bodyPartOf} from '../catalog/catalog';
import {AddExercise} from '../components/AddExercise';
import {ExerciseThumb} from '../components/ExerciseThumb';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
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
      <div className='section-heading templates-heading mt-7'>
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
          <AddExercise
            dataset={dataset}
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
          <div className='editor-footer'>
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
        </section>
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
                      /* `pt-0!` beats the unlayered shared .inline-confirm padding-top (styles.css); drop it
                         when .inline-confirm ports with History (PR 4/5). */
                      <div className='inline-confirm px-4 pt-0! pb-3.5'>
                        <p>Delete this template? Your workout history is kept.</p>
                        <Button onClick={() => setDeleteId(null)}>Cancel</Button>
                        <Button
                          variant='danger'
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
            <div className='empty-state'>
              <h2>No templates yet</h2>
              <p>Create one, or save any finished workout as a template from History.</p>
            </div>
          )}
        </>
      )}
      <Dialog.Root open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className='dialog-overlay' />
          <Dialog.Content className='dialog-content template-preview'>
            <Dialog.Title>{preview?.name}</Dialog.Title>
            <Dialog.Description>
              {preview && lastPerformed(dataset, preview.name)
                ? `Last performed ${dateLabel(lastPerformed(dataset, preview.name)!)}`
                : 'Not performed yet'}
            </Dialog.Description>
            {/* `!` beats the unlayered shared .exercise-rows margin:0 (styles.css); drop it when
                .exercise-rows ports (PR 4/5). */}
            <ul className='exercise-rows mt-3.5! mb-4.5!'>
              {preview?.exercises.map((ex, i) => (
                <li key={`${ex.name}-${i}`} className='exercise-row static'>
                  <ExerciseThumb name={ex.name} />
                  <span className='exercise-row-text'>
                    <strong>
                      {ex.sets.length} × {ex.name}
                    </strong>
                    <small>{bodyPartOf(ex.name)}</small>
                  </span>
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
            <Dialog.Close asChild>
              <Button variant='ghost' size='icon' className='dialog-close' aria-label='Close'>
                <X size={18} />
              </Button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
