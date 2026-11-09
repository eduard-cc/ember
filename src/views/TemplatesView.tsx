import {ClipboardList, Clock, Layers, Pencil, Play, Plus, Trash2} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';

import {OptionsMenu} from '../components/ExerciseMenu';
import {TemplateEditor} from '../components/TemplateEditor';
import {ExerciseLine, Stat} from '../components/exercise-line';
import {Button} from '../components/ui/button';
import {DialogActions} from '../components/ui/dialog';
import {EmptyState} from '../components/ui/empty-state';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '../components/ui/responsive-dialog';
import {SectionHeading} from '../components/ui/section-heading';
import {routineTargets} from '../components/workout-targets';
import type {Dataset, Workout} from '../domain/types';
import {estimatedMinutes} from '../domain/workout-duration';
import {useBackLayer} from '../state/back';
import {newWorkout} from '../state/workout';
import {relativeDay} from '../utils/date';
import {plural} from '../utils/plural';

const CARD_LINES = 4;

/** Latest finished session with the template's exact name, if any. */
function lastPerformed(dataset: Dataset, name: string): string | undefined {
  return dataset.workouts.find((w) => w.name === name)?.date;
}

const setsIn = (workout: Workout) =>
  workout.exercises.reduce((n, exercise) => n + exercise.sets.length, 0);

/** "4 exercises", "~45 min" from the owner's own pace, and when it was last done. */
function TemplateStats({template, dataset}: {template: Workout; dataset: Dataset}) {
  const last = lastPerformed(dataset, template.name);
  const minutes = estimatedMinutes(setsIn(template), dataset.workouts);
  return (
    <>
      <p className='mt-1 flex flex-wrap gap-x-3 gap-y-1'>
        <Stat icon={Layers}>{plural(template.exercises.length, 'exercise')}</Stat>
        {minutes !== null && (
          <Stat icon={Clock}>
            <span aria-hidden='true'>~{minutes} min</span>
            <span className='sr-only'>about {minutes} minutes</span>
          </Stat>
        )}
      </p>
      <p className='mt-0.5 text-[12px]'>
        {last ? `Last done ${relativeDay(last)}` : 'Not done yet'}
      </p>
    </>
  );
}

export function TemplatesView({
  templates,
  dataset,
  onChange,
  onStart,
  disabled,
  locked,
}: {
  disabled: boolean;
  locked: boolean;
  templates: Workout[];
  dataset: Dataset;
  onChange: (templates: Workout[], base?: Workout) => Promise<boolean>;
  onStart: (workout: Workout) => void;
}) {
  const [editing, setEditing] = useState<Workout | null>(null);
  const [editingBase, setEditingBase] = useState<Workout | undefined>();
  const [deleting, setDeleting] = useState<Workout | null>(null);
  // A template just saved from the editor: its card shows the result with a brief Amber border.
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    if (!landed) return;
    const timer = window.setTimeout(() => setLanded(null), 1600);
    return () => window.clearTimeout(timer);
  }, [landed]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // The template's current revision, so a peer's edit shows and starts; gone if deleted.
  const preview = (previewId && templates.find((t) => t.id === previewId)) || null;
  // The preview keeps its template while it slides away.
  const [shown, setShown] = useState<Workout | null>(null);
  if (preview && preview !== shown) setShown(preview);
  const drawn = preview ?? shown;
  useBackLayer(!!preview, () => setPreviewId(null));
  useBackLayer(!!deleting, () => setDeleting(null));
  // What Start will prefill: the latest matching history, else the template's own values.
  const targets = useMemo(
    () => new Map(templates.map((t) => [t.id, routineTargets(t, dataset)])),
    [templates, dataset],
  );
  const planFor = (template: Workout) => targets.get(template.id) ?? template;
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const returnTo = useRef<string | null>(null);
  const started = useRef(false);
  const createButton = useRef<HTMLButtonElement>(null);
  const focusCard = (event: Event) => {
    event.preventDefault();
    const id = returnTo.current;
    returnTo.current = null;
    if (id) cards.current.get(id)?.focus({preventScroll: true});
    else createButton.current?.focus({preventScroll: true});
  };
  const edit = (template: Workout) => {
    returnTo.current = template.id;
    setEditingBase(structuredClone(template));
    setEditing(structuredClone(template));
  };
  return (
    <div className='templates-view'>
      <SectionHeading className='templates-heading mt-7'>
        <h2>Templates</h2>
        <Button
          variant='ghost'
          size='icon'
          ref={createButton}
          aria-label='Create template'
          onClick={() => {
            setEditingBase(undefined);
            setEditing(newWorkout());
          }}
        >
          <Plus size={20} />
        </Button>
      </SectionHeading>
      {!editing && (
        <>
          {!!templates.length && (
            <ul className='template-grid grid grid-cols-1 gap-3 desk:grid-cols-2 desk:logger-open:grid-cols-1'>
              {templates.map((template) => {
                const plan = planFor(template);
                return (
                  <li
                    className='template-card pressable relative flex min-w-0 flex-col rounded-card border border-border bg-card hover:bg-accent/60 has-[.template-open:focus-visible]:outline-2 has-[.template-open:focus-visible]:outline-offset-2 has-[.template-open:focus-visible]:outline-ring'
                    key={template.id}
                    data-landed={landed === template.id ? '' : undefined}
                  >
                    {/* The whole card opens the preview, lifted above the rows (drawings are masks,
                        which paint over an unlifted button); the ⋯ menu sits above it. */}
                    <button
                      type='button'
                      ref={(node) => {
                        if (node) cards.current.set(template.id, node);
                        else cards.current.delete(template.id);
                      }}
                      className='template-open absolute inset-0 z-1 focus-visible:outline-none'
                      aria-label={`Open template ${template.name}`}
                      onClick={() => {
                        setPreviewId(template.id);
                      }}
                    />
                    <div className='p-4 pr-14 pb-0'>
                      <h3 className='text-card-title [overflow-wrap:anywhere]'>{template.name}</h3>
                      <TemplateStats template={template} dataset={dataset} />
                    </div>
                    <ul className='mx-4 mt-3 grid gap-0.5 border-t border-border pt-2 pb-3'>
                      {plan.exercises.slice(0, CARD_LINES).map((exercise, i) => (
                        <ExerciseLine key={i} exercise={exercise} planned />
                      ))}
                      {plan.exercises.length > CARD_LINES && (
                        <li className='pl-[52px] text-[12px] text-muted-foreground tabular-nums'>
                          + {plan.exercises.length - CARD_LINES} more
                        </li>
                      )}
                    </ul>
                    <OptionsMenu
                      className='absolute top-1.5 right-0 z-10'
                      label={`Template options for ${template.name}`}
                      title={template.name}
                      items={[
                        {label: 'Edit template', icon: Pencil, onSelect: () => edit(template)},
                        {
                          label: 'Delete template',
                          icon: Trash2,
                          danger: true,
                          onSelect: () => {
                            returnTo.current = template.id;
                            setDeleting(template);
                          },
                        },
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
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

      {editing && !locked && (
        <TemplateEditor
          workout={editing}
          dataset={dataset}
          existing={!!editingBase}
          disabled={disabled}
          onClose={() => setEditing(null)}
          onCloseAutoFocus={focusCard}
          onSave={async (clean) => {
            const saved = await onChange(
              templates.some((t) => t.id === clean.id)
                ? templates.map((t) => (t.id === clean.id ? clean : t))
                : [...templates, clean],
              editingBase,
            );
            if (saved) setLanded(clean.id);
            return saved;
          }}
        />
      )}

      <ResponsiveDialog open={!!preview} onOpenChange={(open) => !open && setPreviewId(null)}>
        <ResponsiveDialogContent
          className='template-preview max-desk:max-h-[calc(100dvh-2.5rem)] desk:flex desk:flex-col'
          onCloseAutoFocus={(event: Event) => {
            event.preventDefault();
            // Start hands focus to the logger; otherwise it returns to the card.
            if (started.current) started.current = false;
            else if (drawn) cards.current.get(drawn.id)?.focus({preventScroll: true});
          }}
        >
          {drawn && (
            <>
              <ResponsiveDialogHeader className='shrink-0 pr-14 text-left desk:pr-7'>
                <ResponsiveDialogTitle className='[overflow-wrap:anywhere]'>
                  {drawn.name}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className='desk:mt-0'>
                  {(() => {
                    const minutes = estimatedMinutes(setsIn(drawn), dataset.workouts);
                    const last = lastPerformed(dataset, drawn.name);
                    return (
                      <>
                        {plural(drawn.exercises.length, 'exercise')} ·{' '}
                        {plural(setsIn(drawn), 'set')}
                        {minutes !== null && ` · ~${minutes} min`}
                        <br />
                        {last
                          ? `Last done ${relativeDay(last)}; targets come from your latest sets.`
                          : 'Not done yet.'}
                      </>
                    );
                  })()}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
                <ul className='grid gap-0.5 border-t border-border pt-2'>
                  {planFor(drawn).exercises.map((exercise, i) => (
                    <ExerciseLine key={i} exercise={exercise} planned />
                  ))}
                </ul>
              </ResponsiveDialogBody>
              <div className='shrink-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] desk:px-0 desk:pt-5 desk:pb-0'>
                <Button
                  variant='primary'
                  className='min-h-12 w-full text-base'
                  aria-label={`Start template ${drawn.name}`}
                  disabled={!preview}
                  onClick={() => {
                    if (!preview) return;
                    started.current = true;
                    setPreviewId(null);
                    onStart(preview);
                  }}
                >
                  <Play size={16} className='fill-current' /> Start workout
                </Button>
              </div>
              <ResponsiveDialogCornerClose label='Close' />
            </>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <ResponsiveDialogContent className='delete-template' onCloseAutoFocus={focusCard}>
          <ResponsiveDialogHeader className='text-left'>
            <ResponsiveDialogTitle>Delete this template?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {deleting?.name} will be removed.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className='pb-[calc(1rem+env(safe-area-inset-bottom))] desk:pb-0'>
            <DialogActions>
              <ResponsiveDialogClose asChild>
                <Button>Keep template</Button>
              </ResponsiveDialogClose>
              <Button
                variant='danger'
                aria-label='Confirm delete template'
                onClick={() => {
                  if (deleting) void onChange(templates.filter((t) => t.id !== deleting.id));
                  setDeleting(null);
                }}
              >
                Delete template
              </Button>
            </DialogActions>
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
