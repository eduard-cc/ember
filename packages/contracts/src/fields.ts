import {z} from 'zod';

// Source occurrence IDs are opaque strings, not UUIDs. Never normalize them.
export const id = z.string().min(1);
export const nullableNumber = z.number().finite().nullable();
// Validate local wall-time syntax/calendar without converting persisted timestamps.
// Empty dates are supported for the legacy editable template documents.
export const localDate = z
  .string()
  .refine(
    (value) =>
      value === '' ||
      (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + 'Z')) &&
        new Date(value + 'Z').toISOString().slice(0, 19) === value),
    'Invalid local timestamp',
  );
