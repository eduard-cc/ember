import Papa from 'papaparse';

/**
 * One-time cleanup of a Strong CSV export before the go-live import. Applies only fixes the
 * owner approved, listed in a private fixes file (it names real training data, so it never
 * lives in this repository). Every fix either matches exactly what it names or throws, so a
 * fresh export never gets a guessed correction.
 *
 * Fixes file shape (other ids throw; extra keys such as `rule` are notes and are ignored):
 * - `{"id": "duplicate-workouts", "workouts"?: ["<Date> <Workout Name>"], "expected_removed_sets"?: n}`
 *   Generic rule: a workout (same Date and Workout Name) whose second half of rows exactly repeats
 *   its first half loses the second half. Listed workouts must be detected; the expected count
 *   covers the listed workouts. Detections outside the list are applied and reported.
 * - `{"id": "rep-typos", "changes": [[day, exercise, wrongReps, correctedReps]]}`
 *   Each change must match exactly one row on that day (YYYY-MM-DD) for that exercise.
 * - `{"id": "drop-exercise-block", "date": day, "workout": name, "exercise": name, "block": n, "expected_sets": n}`
 *   Drops the n-th (1-based) consecutive block of that exercise in exactly one workout. A block
 *   starts where the exercise starts or its Set Order restarts.
 * - `{"id": "keep-as-is"}` documents approved non-changes and does nothing.
 */
export interface StrongCleanupReport {
  rowsBefore: number;
  rowsAfter: number;
  workoutsBefore: number;
  workoutsAfter: number;
  duplicateWorkouts: {workout: string; removedSets: number; listed: boolean}[];
  repChanges: {date: string; exercise: string; from: number; to: number}[];
  droppedBlocks: {workout: string; exercise: string; block: number; removedSets: number}[];
}
export interface StrongCleanupResult {
  csv: string;
  report: StrongCleanupReport;
}

type Row = string[];
const repeatFields = [
  'Exercise Name',
  'Set Order',
  'Weight',
  'Weight Unit',
  'Reps',
  'Seconds',
  'Distance',
  'Distance Unit',
  'RPE',
  'Notes',
];

function fail(message: string): never {
  throw new Error(`Strong cleanup: ${message}`);
}
function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} must be a list`);
  return value as unknown[];
}
function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) fail(`${what} must be a non-empty string`);
  return value;
}
function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    fail(`${what} must be a whole number`);
  return value;
}
function day(value: unknown, what: string): string {
  const date = text(value, what);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`${what} must be a YYYY-MM-DD day`);
  return date;
}

export function cleanStrongCsv(csvText: string, fixesFile: unknown): StrongCleanupResult {
  const source = csvText.replace(/^\uFEFF/, '');
  // Keep each row's exact source text, so untouched rows are written back byte for byte.
  const parsedRows: Row[] = [];
  const rawText = new Map<Row, string>();
  let cursor = 0,
    malformed = false;
  Papa.parse<Row>(source, {
    delimiter: ';',
    skipEmptyLines: 'greedy',
    step: (result) => {
      if (result.errors.length) malformed = true;
      const end = result.meta.cursor;
      rawText.set(result.data, source.slice(cursor, end).replace(/^[\r\n]+|[\r\n]+$/g, ''));
      cursor = end;
      parsedRows.push(result.data);
    },
  });
  if (malformed) fail('the CSV has malformed rows');
  const [header, ...input] = parsedRows;
  if (!header) fail('the CSV is empty');
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) fail(`the CSV has no ${name} column`);
    return index;
  };
  const date = column('Date'),
    name = column('Workout Name'),
    exercise = column('Exercise Name'),
    setOrder = column('Set Order'),
    reps = column('Reps');
  const repeatColumns = repeatFields.map(column);
  if (input.some((row) => row.length !== header.length)) fail('the CSV has uneven rows');
  const workoutKey = (row: Row) => `${row[date]} ${row[name]}`;
  const workoutCount = (rows: Row[]) => new Set(rows.map(workoutKey)).size;

  if (typeof fixesFile !== 'object' || fixesFile === null) fail('fixes file must be an object');
  const fixes = list((fixesFile as {fixes?: unknown}).fixes, 'fixes');
  const report: StrongCleanupReport = {
    rowsBefore: input.length,
    rowsAfter: 0,
    workoutsBefore: workoutCount(input),
    workoutsAfter: 0,
    duplicateWorkouts: [],
    repChanges: [],
    droppedBlocks: [],
  };
  // Rows are only ever removed or edited in place, so the source order is preserved.
  let rows: Row[] = [...input];
  const edited = new Set<Row>();
  const groups = () => {
    const byWorkout = new Map<string, Row[]>();
    for (const row of rows) {
      const key = workoutKey(row);
      byWorkout.set(key, [...(byWorkout.get(key) ?? []), row]);
    }
    return byWorkout;
  };

  const byId = (id: string) =>
    fixes.filter(
      (fix): fix is Record<string, unknown> =>
        typeof fix === 'object' && fix !== null && (fix as {id?: unknown}).id === id,
    );
  const known = ['duplicate-workouts', 'rep-typos', 'drop-exercise-block'];
  for (const fix of fixes) {
    const id = (fix as {id?: unknown} | null)?.id;
    if (typeof id !== 'string' || ![...known, 'keep-as-is'].includes(id))
      fail(`unknown fix ${JSON.stringify(id)}`);
  }
  if (byId('duplicate-workouts').length > 1) fail('duplicate-workouts is listed twice');

  for (const fix of byId('duplicate-workouts')) {
    const listed = new Set(
      fix.workouts === undefined
        ? []
        : list(fix.workouts, 'duplicate-workouts.workouts').map((w) => text(w, 'workout')),
    );
    const drop = new Set<Row>();
    for (const [key, workoutRows] of groups()) {
      const half = workoutRows.length / 2;
      if (!Number.isInteger(half) || half < 1) continue;
      const repeated = workoutRows
        .slice(0, half)
        .every((row, i) => repeatColumns.every((c) => row[c] === workoutRows[half + i][c]));
      if (!repeated) continue;
      workoutRows.slice(half).forEach((row) => drop.add(row));
      report.duplicateWorkouts.push({workout: key, removedSets: half, listed: listed.has(key)});
    }
    const missing = [...listed].filter(
      (w) => !report.duplicateWorkouts.some((d) => d.workout === w),
    );
    if (missing.length) fail(`listed duplicate workouts not found: ${missing.length}`);
    if (fix.expected_removed_sets !== undefined) {
      const expected = count(fix.expected_removed_sets, 'expected_removed_sets');
      const removed = report.duplicateWorkouts
        .filter((d) => d.listed)
        .reduce((sum, d) => sum + d.removedSets, 0);
      if (removed !== expected)
        fail(`listed duplicate workouts hold ${removed} repeated sets, expected ${expected}`);
    }
    rows = rows.filter((row) => !drop.has(row));
  }

  for (const fix of byId('rep-typos'))
    for (const change of list(fix.changes, 'rep-typos.changes')) {
      const [changeDay, exerciseName, from, to] = list(change, 'rep-typos change');
      const target = {
        date: day(changeDay, 'rep-typos date'),
        exercise: text(exerciseName, 'rep-typos exercise'),
        from: count(from, 'rep-typos wrong reps'),
        to: count(to, 'rep-typos corrected reps'),
      };
      const matches = rows.filter(
        (row) =>
          row[date].startsWith(target.date + ' ') &&
          row[exercise] === target.exercise &&
          row[reps].trim() !== '' &&
          Number(row[reps].replace(',', '.')) === target.from,
      );
      if (matches.length !== 1)
        fail(
          `rep correction ${report.repChanges.length + 1} matches ${matches.length} rows, not 1`,
        );
      matches[0][reps] = String(target.to);
      edited.add(matches[0]);
      report.repChanges.push(target);
    }

  for (const fix of byId('drop-exercise-block')) {
    const target = {
      date: day(fix.date, 'drop-exercise-block date'),
      workout: text(fix.workout, 'drop-exercise-block workout'),
      exercise: text(fix.exercise, 'drop-exercise-block exercise'),
      block: count(fix.block, 'drop-exercise-block block'),
      expected: count(fix.expected_sets, 'drop-exercise-block expected_sets'),
    };
    const workouts = [...groups()].filter(
      ([, workoutRows]) =>
        workoutRows[0][date].startsWith(target.date + ' ') &&
        workoutRows[0][name] === target.workout,
    );
    if (workouts.length !== 1) fail(`block drop matches ${workouts.length} workouts, not 1`);
    const [key, workoutRows] = workouts[0];
    const blocks: Row[][] = [];
    let previous: Row | undefined;
    for (const row of workoutRows) {
      if (row[exercise] === target.exercise) {
        const restarted =
          !previous ||
          previous[exercise] !== target.exercise ||
          !(Number(row[setOrder]) > Number(previous[setOrder]));
        if (restarted) blocks.push([]);
        blocks.at(-1)!.push(row);
      }
      previous = row;
    }
    if (blocks.length < 2) fail(`block drop found ${blocks.length} blocks, expected a repeat`);
    const block = blocks[target.block - 1];
    if (!block) fail(`block drop has no block ${target.block}`);
    if (block.length !== target.expected)
      fail(`block drop block holds ${block.length} sets, expected ${target.expected}`);
    rows = rows.filter((row) => !block.includes(row));
    report.droppedBlocks.push({
      workout: key,
      exercise: target.exercise,
      block: target.block,
      removedSets: block.length,
    });
  }

  report.rowsAfter = rows.length;
  report.workoutsAfter = workoutCount(rows);
  const line = (row: Row) =>
    edited.has(row)
      ? Papa.unparse([row], {delimiter: ';', newline: '\n'})
      : (rawText.get(row) ?? fail('lost a source row'));
  const csv = [header, ...rows].map(line).join('\n') + '\n';
  return {csv, report};
}
