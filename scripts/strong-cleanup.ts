// One-time cleanup of a private Strong export before the go-live import.
//   node scripts/strong-cleanup.ts <export.csv> <approved-fixes.json> <cleaned.csv>
// The fixes file and both CSVs stay outside the repository. The original export is only read;
// the cleaned copy is written with owner-only permissions and must not exist yet.
import {readFileSync, writeFileSync} from 'node:fs';

import {cleanStrongCsv} from '../src/domain/strong-cleanup.ts';

const [input, fixesPath, output] = process.argv.slice(2);
if (!input || !fixesPath || !output || output === input) {
  console.error('Usage: node scripts/strong-cleanup.ts <export.csv> <fixes.json> <cleaned.csv>');
  process.exit(2);
}
const {csv, report} = cleanStrongCsv(
  readFileSync(input, 'utf8'),
  JSON.parse(readFileSync(fixesPath, 'utf8')) as unknown,
);
writeFileSync(output, csv, {mode: 0o600, flag: 'wx'});
// Counts only, so the output can be shared without exposing training data.
const sum = (items: {removedSets: number}[]) => items.reduce((n, item) => n + item.removedSets, 0);
const unlisted = report.duplicateWorkouts.filter((d) => !d.listed).length;
console.log(`Rows: ${report.rowsBefore} -> ${report.rowsAfter}`);
console.log(`Workouts: ${report.workoutsBefore} -> ${report.workoutsAfter}`);
console.log(
  `Duplicate workouts halved: ${report.duplicateWorkouts.length} (${unlisted} not listed), sets removed: ${sum(report.duplicateWorkouts)}`,
);
console.log(`Rep values corrected: ${report.repChanges.length}`);
console.log(
  `Exercise blocks dropped: ${report.droppedBlocks.length}, sets removed: ${sum(report.droppedBlocks)}`,
);
