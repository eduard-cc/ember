import {liveQuery} from 'dexie';
import {ChartLine, ChevronRight, Plus, Scale} from 'lucide-react';
import {type FormEvent, useEffect, useRef, useState} from 'react';

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
import {dateLabel} from '../views/WorkoutView';
import {SettingsGroup, SettingsList, settingsRowClass} from './settings-group';
import {Button} from './ui/button';
import {Card} from './ui/card';
import {trendChartClass} from './ui/chart';
import {ContentFieldset} from './ui/content-fieldset';
import {EmptyState} from './ui/empty-state';
import {fieldLabelClass} from './ui/field-label';
import {InlineError} from './ui/inline-error';
import {Input} from './ui/input';

const time = (date: string) => date.slice(11, 16);
const describe = (m: BodyWeight) => `${dateLabel(m.date)} ${time(m.date)}, ${formatKg(m.kg)} kg`;

/** Exact-value list is the accessible alternative; the chart only draws real entries. */
function WeightChart({entries}: {entries: BodyWeight[]}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // One SVG unit per CSS pixel keeps labels at their declared size on any width.
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const points = [...entries].reverse();
  const values = points.map((p) => p.kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || max * 0.05 || 1;
  const ticks = [min, min + spread / 2, min + spread];
  // Hundredth-kg entries can put the midpoint at a half-hundredth. Keep all three
  // labels distinct instead of rounding a small real change into a flat-looking axis.
  const precision =
    [1, 2, 3].find((digits) => new Set(ticks.map((v) => v.toFixed(digits))).size === 3) ?? 3;
  const labels = ticks.map((v) => String(Number(v.toFixed(precision))));
  const plotLeft = Math.max(54, ...labels.map((label) => label.length * 7 + 14));
  const plotRight = width - 46;
  const times = points.map((p) => new Date(p.date).getTime());
  const span = times.at(-1)! - times[0];
  const x = (i: number) =>
    plotLeft + (span ? (times[i] - times[0]) / span : 0.5) * (plotRight - plotLeft);
  const y = (kg: number) => 195 - ((kg - min) / spread) * 135;
  return (
    <div ref={containerRef}>
      <svg
        className={trendChartClass}
        viewBox={`0 0 ${width} 235`}
        role='img'
        aria-label={`Body weight over time. ${points.length} entries from ${dateLabel(points[0].date)} to ${dateLabel(points.at(-1)!.date)}. Exact values in the list below.`}
      >
        {ticks.map((value, i) => (
          <g key={i}>
            <line x1={plotLeft} x2={plotRight} y1={y(value)} y2={y(value)} strokeDasharray='4 5' />
            <text x={plotLeft - 14} y={y(value) + 4} textAnchor='end'>
              {labels[i]}
            </text>
          </g>
        ))}
        <polyline
          points={points.map((p, i) => `${x(i)},${y(p.kg)}`).join(' ')}
          fill='none'
          strokeWidth='2.5'
          strokeLinejoin='round'
        />
        {points.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(p.kg)} r='4'>
            <title>{describe(p)}</title>
          </circle>
        ))}
        <text x={plotLeft} y='226'>
          {dateLabel(points[0].date)}
        </text>
        <text x={plotRight} y='226' textAnchor='end'>
          {dateLabel(points.at(-1)!.date)}
        </text>
      </svg>
    </div>
  );
}

interface Editing {
  base: BodyWeight | null;
  kg: string;
  when: string;
}
/**
 * Body weight in kg: a chart of the full history above newest-first entries. Entries are
 * device-durable documents that sync on their own; they never touch workouts or imports.
 * Undo covers the latest deletion in this mounted Settings view only. Opening another
 * add/edit form or leaving Settings ends it; deleted entries remain sync tombstones.
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
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [undo, setUndo] = useState<BodyWeight | null>(null);
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
    if (editing) kgRef.current?.focus();
    // Focus on form transitions or Undo dismissal, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!editing, editing?.base?.id, !!undo]);
  const entries = sortedMeasurements(stored ?? []);
  const write = async (next: BodyWeight, base: BodyWeight | null) => {
    setSaving(true);
    try {
      await repository.putBodyWeight(next, base);
      setError('');
      return true;
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
      return false;
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
    if (await write(next, editing.base)) {
      setUndo(null);
      close();
    }
  };
  const remove = async () => {
    if (!editing?.base || saving || disabled) return;
    const tombstone = {...editing.base, deleted: true};
    if (await write(tombstone, editing.base)) {
      setUndo(tombstone);
      close();
    }
  };
  const restore = async () => {
    if (!undo || saving || disabled) return;
    if (await write({...undo, deleted: false}, undo)) {
      returnFocus.current = true;
      setUndo(null);
    }
  };
  const add = (
    <Button
      ref={addRef}
      disabled={disabled || !!editing || stored === null}
      onClick={() => {
        setUndo(null);
        setError('');
        setEditing({base: null, kg: '', when: toLocalInput(localNow())});
      }}
    >
      <Plus size={17} />
      Add weight
    </Button>
  );
  const form = editing && (
    <form onSubmit={submit} aria-label={editing.base ? 'Edit entry' : 'New entry'}>
      <ContentFieldset disabled={disabled || saving}>
        {/* Phones give the native date and time picker a full-width row under kg. */}
        <div className='grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2.5 max-[480px]:grid-cols-1'>
          <label>
            <span className={cn(fieldLabelClass, 'mt-0')}>Weight in kg</span>
            <Input
              ref={kgRef}
              aria-label='Weight in kg'
              inputMode='decimal'
              autoComplete='off'
              value={editing.kg}
              onChange={(e) => setEditing({...editing, kg: e.target.value})}
            />
          </label>
          <label>
            <span className={cn(fieldLabelClass, 'mt-0')}>Date and time</span>
            <Input
              aria-label='Date and time'
              type='datetime-local'
              value={editing.when}
              onChange={(e) => setEditing({...editing, when: e.target.value})}
            />
          </label>
        </div>
        {error && (
          <InlineError role='alert' className='mt-3.5'>
            {error}
          </InlineError>
        )}
        <div className='mt-3.5 flex flex-wrap gap-2'>
          <Button type='submit' variant='primary'>
            Save entry
          </Button>
          <Button type='button' onClick={close}>
            Cancel
          </Button>
          {editing.base && (
            <Button
              type='button'
              className='ml-auto text-destructive'
              onClick={() => void remove()}
            >
              Delete entry
            </Button>
          )}
        </div>
      </ContentFieldset>
    </form>
  );
  return (
    <SettingsGroup
      id='body-weight-heading'
      title='Body weight'
      description='Separate from workouts, lifted weights and Strong imports.'
      action={add}
    >
      <div className='flex flex-col gap-3'>
        {!editing && error && <InlineError role='alert'>{error}</InlineError>}
        {undo && (
          // `.notice` carries a 20px bottom margin for the banners; the column gap spaces it here.
          // Remove `mb-0!` when PR 6 ports `.notice`.
          <div className='notice mb-0!' role='status'>
            Entry from {dateLabel(undo.date)} deleted.
            <Button disabled={disabled || saving} onClick={() => void restore()}>
              Undo
            </Button>
          </div>
        )}
        {/* The form and the chart share one card; with no entries the empty state stands alone. */}
        {stored !== null && (editing || entries.length > 0) && (
          <Card className='body-weight-chart'>
            {form}
            {entries.length > 0 && (
              <div className={cn(editing && 'mt-5 border-t border-border pt-5')}>
                <h3>Weight (kg)</h3>
                {entries.length >= 2 ? (
                  <WeightChart entries={entries} />
                ) : (
                  <EmptyState
                    framed={false}
                    titleAs='h3'
                    icon={ChartLine}
                    title='One entry so far'
                    description='Add another entry to see a trend.'
                  />
                )}
              </div>
            )}
          </Card>
        )}
        {stored !== null && entries.length === 0 && (
          <EmptyState
            titleAs='h3'
            icon={Scale}
            title='No entries yet'
            description='Add your weight to start a chart.'
          />
        )}
        {entries.length > 0 && (
          <SettingsList as='ul' aria-label='Body weight history'>
            {entries.map((m) => (
              <li key={m.id}>
                <button
                  className={cn(
                    settingsRowClass,
                    'w-full text-left tabular-nums hover:not-disabled:bg-accent focus-visible:-outline-offset-2',
                  )}
                  aria-label={`Edit entry ${describe(m)}`}
                  disabled={disabled || !!editing}
                  onClick={() => {
                    setUndo(null);
                    setError('');
                    setEditing({base: m, kg: formatKg(m.kg), when: toLocalInput(m.date)});
                  }}
                >
                  <span className='flex min-w-0 flex-col'>
                    <span className='text-sm font-medium'>{dateLabel(m.date)}</span>
                    <span className='mt-0.5 text-sm text-muted-foreground'>{time(m.date)}</span>
                  </span>
                  <span className='ml-auto text-base font-semibold'>
                    {formatKg(m.kg)}{' '}
                    <small className='text-[12px] font-normal text-muted-foreground'>kg</small>
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
    </SettingsGroup>
  );
}
