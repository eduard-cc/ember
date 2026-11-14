/**
 * Keys that older documents may still carry: sets once held `excluded`/`suspicious` review
 * flags and import warnings a `suspiciousRows` count. Stored, synced and backed-up documents
 * keep loading; the parsed result never contains them.
 */
export const RETIRED_SET_KEYS = ['excluded', 'suspicious'] as const;
export const RETIRED_WARNING_KEYS = ['suspiciousRows'] as const;

/** A `z.preprocess` step that drops `keys` from a plain object and passes anything else through. */
export const withoutKeys =
  (keys: readonly string[]) =>
  (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const rest: Record<string, unknown> = {...value};
    for (const key of keys) delete rest[key];
    return rest;
  };
