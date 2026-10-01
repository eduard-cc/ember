import {z} from 'zod';

import {AppStateSchema, LocalOperationSchema} from './contracts';

export const BackupSchema = z
  .object({
    format: z.literal('gym-log-backup'),
    version: z.literal(1),
    exportedAt: z.iso.datetime(),
    state: AppStateSchema,
    sources: z.array(
      z
        .object({
          key: z.string().min(1),
          raw: z.string().nullable(),
          hash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
          workoutIds: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    provenance: z
      .object({
        ownerId: z.string().min(1).nullable(),
        cursor: z.number().int().nonnegative().nullable(),
        revisions: z.array(
          z.object({entityId: z.string().min(1), revision: z.number().int().positive()}).strict(),
        ),
      })
      .strict(),
    draftOwnership: z
      .object({
        installationId: z.string().nullable(),
        policy: z.literal('local-only-deliberate-restore'),
      })
      .strict(),
    pendingOperations: z
      .object({
        label: z.literal('diagnostic-only-not-restored'),
        operations: z.array(LocalOperationSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((backup, context) => {
    const unique = (ids: string[], label: string) => {
      if (new Set(ids).size !== ids.length)
        context.addIssue({code: 'custom', message: `Duplicate ${label} identity`});
    };
    const history = [...(backup.state.dataset?.workouts ?? []), ...backup.state.finished];
    unique(
      [
        ...history,
        ...(backup.state.templates ?? []),
        ...(backup.state.active ? [backup.state.active] : []),
      ].map((w) => w.id),
      'domain document',
    );
    unique(
      backup.sources.map((s) => s.key),
      'source',
    );
    unique(
      backup.provenance.revisions.map((r) => r.entityId),
      'revision',
    );
    for (const source of backup.sources) {
      unique(source.workoutIds, 'source workout');
      if (source.key.startsWith('imported:'))
        context.addIssue({
          code: 'custom',
          message: 'Working indexes cannot be restored as source evidence',
        });
      if (source.key.startsWith('hash:') && source.key !== 'hash:' + source.hash)
        context.addIssue({code: 'custom', message: 'Source hash identity mismatch'});
    }
    unique(
      backup.pendingOperations.operations.map((o) => o.operationId),
      'operation',
    );
    // Repeated templates/drafts may retain set targets; occurrence identities within
    // a workout and persisted history must still be unambiguous.
    unique(
      history.flatMap((w) => w.exercises.flatMap((e) => e.sets.map((s) => s.id))),
      'history set',
    );
    for (const w of [
      ...history,
      ...(backup.state.templates ?? []),
      ...(backup.state.active ? [backup.state.active] : []),
    ])
      unique(
        w.exercises.flatMap((e) => e.sets.map((s) => s.id)),
        'workout set',
      );
  });
export type Backup = z.infer<typeof BackupSchema>;
export function parseBackup(text: string): Backup {
  return BackupSchema.parse(JSON.parse(text));
}
