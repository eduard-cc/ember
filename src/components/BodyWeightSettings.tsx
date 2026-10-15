import {liveQuery} from 'dexie';
import {ChevronRight, Plus} from 'lucide-react';
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
import {dateLabel} from '../views/WorkoutView';
import {Button, Input} from './ui';

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
        className='trend-chart'
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
  return (
    <section aria-label='Body weight' className='body-weight'>
      <div className='section-heading'>
        <h3>Body weight</h3>
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
      </div>
      <p>Separate from workouts, lifted weights and Strong imports.</p>
      {editing && (
        <form
          className='body-weight-form'
          onSubmit={submit}
          aria-label={editing.base ? 'Edit entry' : 'New entry'}
        >
          <fieldset disabled={disabled || saving} className='content-fieldset'>
            <div className='body-weight-fields'>
              <label>
                <span className='field-label'>Weight in kg</span>
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
                <span className='field-label'>Date and time</span>
                <Input
                  aria-label='Date and time'
                  type='datetime-local'
                  value={editing.when}
                  onChange={(e) => setEditing({...editing, when: e.target.value})}
                />
              </label>
            </div>
            {error && (
              <p className='inline-error' role='alert'>
                {error}
              </p>
            )}
            <div className='body-weight-actions'>
              <Button type='submit' variant='primary'>
                Save entry
              </Button>
              <Button type='button' onClick={close}>
                Cancel
              </Button>
              {editing.base && (
                <Button type='button' variant='danger' onClick={() => void remove()}>
                  Delete entry
                </Button>
              )}
            </div>
          </fieldset>
        </form>
      )}
      {!editing && error && (
        <p className='inline-error' role='alert'>
          {error}
        </p>
      )}
      {undo && (
        <div className='notice' role='status'>
          Entry from {dateLabel(undo.date)} deleted.
          <Button disabled={disabled || saving} onClick={() => void restore()}>
            Undo
          </Button>
        </div>
      )}
      {stored !== null && (
        <>
          <div className='analytics-card body-weight-chart'>
            <h4>Weight (kg)</h4>
            {entries.length >= 2 ? (
              <WeightChart entries={entries} />
            ) : (
              <div className='empty-chart'>
                <p>
                  {entries.length
                    ? 'One entry so far. Add another entry to see a trend.'
                    : 'No entries yet. Add your weight to start a chart.'}
                </p>
              </div>
            )}
          </div>
          {entries.length > 0 && (
            <ul className='body-weight-list' aria-label='Body weight history'>
              {entries.map((m) => (
                <li key={m.id}>
                  <button
                    className='body-weight-row'
                    aria-label={`Edit entry ${describe(m)}`}
                    disabled={disabled || !!editing}
                    onClick={() => {
                      setUndo(null);
                      setError('');
                      setEditing({base: m, kg: formatKg(m.kg), when: toLocalInput(m.date)});
                    }}
                  >
                    <span>
                      <strong>{dateLabel(m.date)}</strong>
                      <small>{time(m.date)}</small>
                    </span>
                    <span className='body-weight-value'>
                      {formatKg(m.kg)} <small>kg</small>
                    </span>
                    <ChevronRight size={16} aria-hidden='true' />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
