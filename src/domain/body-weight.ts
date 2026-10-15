import type {BodyWeight} from '../../shared/contracts';

export const MAX_BODY_WEIGHT_KG = 500;

/** Typed kg (comma or point, at most two decimals) or null when ambiguous/out of range. */
export function parseKg(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) return null;
  const kg = Number(normalized);
  return kg > 0 && kg <= MAX_BODY_WEIGHT_KG ? kg : null;
}
export const formatKg = (kg: number) => String(Number(kg.toFixed(2)));

/** `<input type=datetime-local>` value to a stored local wall time, or null if invalid. */
export function fromLocalInput(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/.exec(value);
  if (!match) return null;
  const stamp = match[1] + (match[2] ?? ':00');
  const parsed = new Date(stamp + 'Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === stamp
    ? stamp
    : null;
}
export const toLocalInput = (date: string) => date.slice(0, 16);
export function localNow(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
}

/** Live (non-deleted) measurements, newest first; equal times fall back to a stable id order. */
export function sortedMeasurements(measurements: readonly BodyWeight[]): BodyWeight[] {
  return measurements
    .filter((m) => !m.deleted)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
