import {liveQuery} from 'dexie';
import {ChevronRight, Plus, Scale, Trash2} from 'lucide-react';
import {type FormEvent, useEffect, useEffectEvent, useMemo, useRef, useState} from 'react';

import type {BodyWeight} from '../../shared/contracts';
import {
  formatKg,
  fromLocalInput,
  localNow,
  parseKg,
  sortedMeasurements,
  toLocalInput,
} from '../domain/body-weight';
import {useBackLayer} from '../state/back';
import type {WorkoutRepository} from '../storage/repository';
import {cn} from '../utils/cn';
import {dateLabel, localDay} from '../utils/date';
import {SegmentToggle} from './segment-toggle';
import {SettingsGroup, SettingsList, settingsRowClass} from './settings-group';
import {SETTINGS_TOASTER, dismissToast, toastFailed, toastUndo} from './toasts';
import {TrendArea} from './trend-area';
import {Button} from './ui/button';
import {Card} from './ui/card';
import {EmptyChart} from './ui/chart';
import {ContentFieldset} from './ui/content-fieldset';
import {EmptyState} from './ui/empty-state';
import {fieldLabelClass} from './ui/field-label';
import {InlineError} from './ui/inline-error';
import {Input} from './ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './ui/responsive-dialog';

const time = (date: string) => date.slice(11, 16);
const describe = (m: BodyWeight) => `${dateLabel(m.date)} ${time(m.date)}, ${formatKg(m.kg)} kg`;

// The exercise charts' ranges, so both trends read the same way.
const ranges = [
  {value: '30', label: '1M'},
  {value: '90', label: '3M'},
  {value: '180', label: '6M'},
  {value: '365', label: '1Y'},
  {value: 'all', label: 'All'},
];
/** Entries (newest first) measured on or after the range's first local day. */
function inRange(entries: BodyWeight[], range: string) {
  if (range === 'all') return entries;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(range));
  const firstDay = localDay(cutoff);
  return entries.filter((m) => m.date.slice(0, 10) >= firstDay);
}

type WeightPoint = BodyWeight & {t: number; value: number};

/**
 * The exercise charts' headline over the same plot: latest (or inspected) kg, then the change
 * since the range's first entry. A weight change is never coloured as good or bad.
 */
function WeightChart({entries, total}: {entries: BodyWeight[]; total: number}) {
  const data = useMemo(
    () => [...entries].reverse().map((p) => ({...p, t: new Date(p.date).getTime(), value: p.kg})),
    [entries],
  );
  const [hover, setHover] = useState<WeightPoint | null>(null);
  const inspected = hover && data.includes(hover) ? hover : null;
  const first = data[0];
  const last = data.at(-1)!;
  const shown = inspected ?? last;
  const delta = Number((last.kg - first.kg).toFixed(2));
  return (
    <>
      <div className='chart-headline min-h-[4.25rem]'>
        <p className='weight-chart-value flex flex-wrap items-baseline gap-1.5 text-foreground'>
          <span className='numeric text-stat'>{formatKg(shown.kg)}</span>{' '}
          <span className='text-sm font-medium text-muted-foreground'>kg</span>
        </p>
        <p className='weight-chart-detail mt-1 numeric text-label font-normal text-muted-foreground'>
          {inspected || data.length < 2 ? (
            <>
              <span className='text-foreground'>{dateLabel(shown.date)}</span> · {time(shown.date)}
            </>
          ) : delta === 0 ? (
            `No change since ${dateLabel(first.date)}`
          ) : (
            <>
              <span className='font-medium text-foreground'>
                {delta > 0 ? '+' : '−'}
                {formatKg(Math.abs(delta))} kg
              </span>{' '}
              since {dateLabel(first.date)}
            </>
          )}
        </p>
      </div>
      {data.length >= 2 ? (
        <div className='grid gap-2'>
          <TrendArea
            data={data}
            onInspect={setHover}
            label={`Body weight over time. ${data.length} entries from ${dateLabel(first.date)} to ${dateLabel(last.date)}. Exact values in the list below.`}
          />
          <p className='text-label font-normal text-muted-foreground'>
            Hold and slide to inspect an entry.
          </p>
        </div>
      ) : (
        <EmptyChart className='py-8'>
          <p className='text-sm text-muted-foreground'>
            {total > 1 ? 'One entry in this range.' : 'Add another entry to see a trend.'}
          </p>
        </EmptyChart>
      )}
    </>
  );
}

interface Editing {
  base: BodyWeight | null;
  kg: string;
  when: string;
}
/**
 * Body weight in kg: a chart above newest-first entries, both narrowed by the selected range.
 * Entries are device-durable documents that sync on their own; they never touch workouts or
 * imports.
 * Undo is a short toast for the latest deletion in this mounted Settings view only. It ends
 * when the toast closes, another add/edit form opens or Settings closes; deleted entries remain
 * sync tombstones.
 */
export function BodyWeightSettings({
  repository,
  disabled,
}: {
  repository: WorkoutRepository;
  disabled: boolean;
}) {
  const [stored, setStored] = useState<BodyWeight[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [shown, setShown] = useState<Editing | null>(null);
  if (editing && editing !== shown) setShown(editing);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [undo, setUndo] = useState<BodyWeight | null>(null);
  // A deletion whose Undo failed for a reason other than a newer revision; Retry tries again
  // until it is dismissed or, like Undo, another add/edit starts.
  const [unrestored, setUnrestored] = useState<BodyWeight | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const kgRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    const subscription = liveQuery(() => repository.readBodyWeights()).subscribe({
      next: setStored,
      error: () => setError('Body weight could not be read on this device.'),
    });
    return () => subscription.unsubscribe();
  }, [repository]);
  useEffect(() => {
    // Runs after commit, so Add weight is already re-enabled when focus returns to it.
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      addRef.current?.focus();
    }
    // Focus on form transitions or Undo dismissal, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!editing, editing?.base?.id, !!undo]);
  const entries = sortedMeasurements(stored ?? []);
  const [range, setRange] = useState('all');
  const shownEntries = inRange(entries, range);
  const write = async (next: BodyWeight, base: BodyWeight | null) => {
    setSaving(true);
    try {
      await repository.putBodyWeight(next, base);
      setError('');
      return 'saved';
    } catch (cause) {
      const changed = cause instanceof Error && cause.message.includes('changed');
      if (changed && base?.deleted) {
        // A newer revision invalidates this one-action Undo; retrying it would stay stale.
        returnFocus.current = true;
        setUndo(null);
      }
      setError(
        changed
          ? base?.deleted
            ? 'This entry changed on another device. Undo was not applied; review the latest history below.'
            : 'This entry changed on another device. Cancel, review the latest value and try again.'
          : 'Could not save on this device. Nothing was changed; retry.',
      );
      return changed ? 'changed' : 'failed';
    } finally {
      setSaving(false);
    }
  };
  const close = () => {
    returnFocus.current = true;
    setEditing(null);
    setError('');
  };
  useBackLayer(!!editing, close);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || saving || disabled) return;
    const kg = parseKg(editing.kg);
    if (kg === null)
      return setError('Enter a weight above 0 and up to 500 kg, with at most two decimals.');
    // An untouched date/time keeps the stored value exactly (the field shows minutes only).
    const date =
      editing.base && toLocalInput(editing.base.date) === editing.when
        ? editing.base.date
        : fromLocalInput(editing.when);
    if (date === null) return setError('Enter a valid date and time.');
    const next = {id: editing.base?.id ?? crypto.randomUUID(), date, kg, deleted: false};
    if ((await write(next, editing.base)) === 'saved') {
      setUndo(null);
      close();
    }
  };
  const remove = async () => {
    if (!editing?.base || saving || disabled) return;
    const tombstone = {...editing.base, deleted: true};
    if ((await write(tombstone, editing.base)) === 'saved') {
      setUndo(tombstone);
      close();
    }
  };
  // Toast actions run after the render that created them, so they read the current state here.
  const restore = useEffectEvent(async (entry: BodyWeight) => {
    if (saving || disabled) return;
    setUnrestored(null);
    const result = await write({...entry, deleted: false}, entry);
    if (result === 'saved') {
      returnFocus.current = true;
      setUndo(null);
    } else if (result === 'failed') {
      // The failure toast replaces the inline message; a newer revision keeps its explanation.
      setError('');
      setUndo(null);
      setUnrestored({...entry});
    }
  });
  useEffect(() => {
    if (!undo) return;
    const id = toastUndo(`Entry from ${dateLabel(undo.date)} deleted`, () => void restore(undo), {
      toasterId: SETTINGS_TOASTER,
      onDismiss: () => setUndo((shown) => (shown === undo ? null : shown)),
      onAutoClose: () => setUndo((shown) => (shown === undo ? null : shown)),
    });
    return () => void dismissToast(id);
  }, [undo]);
  useEffect(() => {
    if (!unrestored) return;
    const id = toastFailed('Entry not restored', () => void restore(unrestored), {
      toasterId: SETTINGS_TOASTER,
      onDismiss: () => setUnrestored((shown) => (shown === unrestored ? null : shown)),
    });
    return () => void dismissToast(id);
  }, [unrestored]);
  const add = (
    <Button
      ref={addRef}
      disabled={disabled || !!editing || stored === null}
      onClick={() => {
        setUndo(null);
        setUnrestored(null);
        setError('');
        setEditing({base: null, kg: '', when: toLocalInput(localNow())});
      }}
    >
      <Plus size={17} />
      Add weight
    </Button>
  );
  const form = shown && (
    <form onSubmit={submit} aria-label={shown.base ? 'Edit entry' : 'New entry'}>
      <ContentFieldset disabled={disabled || saving || !editing}>
        {/* Phones give the native date and time picker a full-width row under kg. */}
        <div className='grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2.5 max-[480px]:grid-cols-1'>
          <label>
            <span className={cn(fieldLabelClass, 'mt-0')}>Weight</span>
            <span className='relative block'>
              <Input
                ref={kgRef}
                aria-label='Weight in kg'
                inputMode='decimal'
                autoComplete='off'
                className='pr-10 numeric text-set-value'
                value={shown.kg}
                onChange={(e) => setEditing({...shown, kg: e.target.value})}
              />
              <span
                aria-hidden='true'
                className='pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-muted-foreground'
              >
                kg
              </span>
            </span>
          </label>
          <label>
            <span className={cn(fieldLabelClass, 'mt-0')}>Date and time</span>
            <Input
              aria-label='Date and time'
              type='datetime-local'
              value={shown.when}
              onChange={(e) => setEditing({...shown, when: e.target.value})}
            />
          </label>
        </div>
        {error && (
          <InlineError role='alert' className='mt-3.5'>
            {error}
          </InlineError>
        )}
        {/* Phones stack the drawer's actions with Save on top, like its other drawers. */}
        <div className='mt-5 flex flex-wrap gap-2 max-desk:flex-col max-desk:*:min-h-12'>
          <Button type='submit' variant='primary'>
            Save entry
          </Button>
          <Button type='button' onClick={close}>
            Cancel
          </Button>
          {shown.base && (
            <Button
              type='button'
              className='text-destructive max-desk:mt-3 desk:ml-auto'
              onClick={() => void remove()}
            >
              <Trash2 size={16} aria-hidden='true' />
              Delete entry
            </Button>
          )}
        </div>
      </ContentFieldset>
    </form>
  );
  return (
    <SettingsGroup id='body-weight-heading' titleAs='h3' title='Body weight' action={add}>
      <div className='flex flex-col gap-3'>
        {!editing && error && <InlineError role='alert'>{error}</InlineError>}
        {stored !== null && entries.length > 0 && (
          <Card className='body-weight-chart grid gap-4'>
            {shownEntries.length > 0 ? (
              <WeightChart key={range} entries={shownEntries} total={entries.length} />
            ) : (
              <EmptyChart>
                <p className='text-sm text-muted-foreground'>No entries in this range.</p>
              </EmptyChart>
            )}
            {/* A narrowed range stays switchable even when a delete leaves one entry outside it. */}
            {(entries.length > 1 || range !== 'all') && (
              <SegmentToggle
                value={range}
                onChange={setRange}
                label='Time range'
                items={ranges}
                className='justify-start'
                itemClassName='px-2.5'
              />
            )}
          </Card>
        )}
        {stored !== null && entries.length === 0 && (
          <EmptyState
            titleAs='h4'
            icon={Scale}
            title='No entries yet'
            description='Add your weight to start a chart.'
          />
        )}
        {shownEntries.length > 0 && (
          <SettingsList as='ul' aria-label='Body weight history'>
            {shownEntries.map((m) => (
              <li key={m.id}>
                <button
                  className={cn(
                    settingsRowClass,
                    'pressable min-h-14 w-full text-left tabular-nums hover:not-disabled:bg-accent focus-visible:-outline-offset-2',
                  )}
                  aria-label={`Edit entry ${describe(m)}`}
                  disabled={disabled || !!editing}
                  onClick={() => {
                    setUndo(null);
                    setUnrestored(null);
                    setError('');
                    setEditing({base: m, kg: formatKg(m.kg), when: toLocalInput(m.date)});
                  }}
                >
                  <span className='min-w-0 text-sm'>
                    <span className='font-medium'>{dateLabel(m.date)}</span>
                    <span className='text-muted-foreground'> · {time(m.date)}</span>
                  </span>
                  <span className='ml-auto shrink-0 text-sm font-semibold'>
                    {formatKg(m.kg)} <span className='font-normal text-muted-foreground'>kg</span>
                  </span>
                  <ChevronRight
                    size={16}
                    aria-hidden='true'
                    className='shrink-0 text-muted-foreground'
                  />
                </button>
              </li>
            ))}
          </SettingsList>
        )}
      </div>
      <ResponsiveDialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !saving) close();
        }}
      >
        <ResponsiveDialogContent
          className='body-weight-editor dialog-content'
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            kgRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            addRef.current?.focus();
          }}
        >
          <ResponsiveDialogHeader className='text-left'>
            <ResponsiveDialogTitle>
              {shown?.base ? 'Edit body weight' : 'Add body weight'}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className='pb-[calc(1rem+env(safe-area-inset-bottom))] desk:mt-5 desk:pb-0'>
            {form}
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </SettingsGroup>
  );
}
