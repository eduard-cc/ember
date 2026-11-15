import {BadRequestException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {DataSource} from 'typeorm';
import type {z} from 'zod';

import {lockOwner, requireEpoch} from './reset';
import {batch, operation} from './schema';

type OperationKind = z.infer<typeof operation>['kind'];
type OperationResult = {
	operationId: unknown;
	entityId: unknown;
	status: 'accepted' | 'conflict' | 'rejected';
	revision: number | null;
	changeSeq: number | null;
	errorCode?: string;
};
type LedgerRow = {payload_hash: string; result: OperationResult};
type RecordRow = {revision: number; kind: OperationKind};
// bigint columns arrive from pg as strings.
type ChangeRow = {seq: string; entity_id: string; kind: OperationKind; revision: number; payload: unknown};

function canonical(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
	const object = value as Record<string, unknown>;
	return (
		'{' +
		Object.keys(object)
			.sort()
			.filter((k) => object[k] !== undefined)
			.map((k) => JSON.stringify(k) + ':' + canonical(object[k]))
			.join(',') +
		'}'
	);
}
/** A field of an operation that failed validation, echoed back so the client can match the rejection. */
function echoed(input: unknown, key: 'operationId' | 'entityId'): unknown {
	return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined;
}
// Each kind may only revise records of its own kind, so a measurement can never
// overwrite workout history, nor native history an import, and vice versa.
// The owner may edit finished and imported workouts and delete them; every
// update needs the expected revision and earlier revisions stay in `changes`.
// Native workout tombstones are final; a put at an imported tombstone's revision revives it.
// Keyed by the schema's kind enum, so a new kind without an entry fails to compile.
const allowedKinds: Record<OperationKind, readonly OperationKind[]> = {
	putBodyWeight: ['putBodyWeight'],
	putWorkout: ['putWorkout'],
	deleteWorkout: ['putWorkout'],
	putImportedWorkout: ['putImportedWorkout', 'deleteImportedWorkout'],
	deleteImportedWorkout: ['putImportedWorkout'],
	putTemplate: ['putTemplate'],
	deleteTemplate: ['putTemplate'],
};
export class SyncService {
	constructor(private db: DataSource) {}
	async operations(owner: string, body: unknown, epoch?: unknown) {
		const b = batch.safeParse(body);
		if (!b.success) throw new BadRequestException('Invalid batch');
		const results: OperationResult[] = [];
		for (const input of b.data.operations) {
			const parsed = operation.safeParse(input);
			if (!parsed.success) {
				results.push({
					operationId: echoed(input, 'operationId') ?? null,
					entityId: echoed(input, 'entityId') ?? null,
					status: 'rejected',
					revision: null,
					changeSeq: null,
					errorCode: 'INVALID_OPERATION',
				});
				continue;
			}
			const o = parsed.data;
			const hash = createHash('sha256').update(canonical(o)).digest('hex');
			results.push(
				await this.db.transaction(async (tx): Promise<OperationResult> => {
					await lockOwner(tx, owner);
					await requireEpoch(tx, owner, epoch);
					const [existing] = await tx.query<LedgerRow[]>(
						'SELECT * FROM operation_ledger WHERE owner_id=$1 AND operation_id=$2',
						[owner, o.operationId],
					);
					if (existing)
						return existing.payload_hash === hash
							? existing.result
							: {
									operationId: o.operationId,
									entityId: o.entityId,
									status: 'conflict',
									revision: null,
									changeSeq: null,
									errorCode: 'OPERATION_ID_REUSED',
								};
					const [record] = await tx.query<RecordRow[]>(
						'SELECT revision, kind FROM records WHERE owner_id=$1 AND entity_id=$2',
						[owner, o.entityId],
					);
					const mismatch =
						o.expectedRevision === null
							? !!record
							: !record ||
								record.revision !== o.expectedRevision ||
								!allowedKinds[o.kind].includes(record.kind);
					if (mismatch) {
						const conflict: OperationResult = {
							operationId: o.operationId,
							entityId: o.entityId,
							status: 'conflict',
							revision: record?.revision ?? null,
							changeSeq: null,
							errorCode: 'REVISION_CONFLICT',
						};
						await tx.query('INSERT INTO operation_ledger VALUES ($1,$2,$3,$4)', [
							owner,
							o.operationId,
							hash,
							conflict,
						]);
						return conflict;
					}
					const revision = record ? record.revision + 1 : 1;
					const [s] = await tx.query<{seq: string}[]>(
						'INSERT INTO owner_sequences(owner_id, seq) VALUES ($1, 1) ON CONFLICT (owner_id) DO UPDATE SET seq=owner_sequences.seq+1 RETURNING seq',
						[owner],
					);
					await tx.query(
						'INSERT INTO records VALUES ($1,$2,$3,$4,$5) ON CONFLICT (owner_id,entity_id) DO UPDATE SET kind=EXCLUDED.kind,revision=EXCLUDED.revision,payload=EXCLUDED.payload',
						[owner, o.entityId, o.kind, revision, o.payload],
					);
					await tx.query('INSERT INTO changes VALUES ($1,$2,$3,$4,$5,$6)', [
						owner,
						s.seq,
						o.entityId,
						o.kind,
						revision,
						o.payload,
					]);
					const result: OperationResult = {
						operationId: o.operationId,
						entityId: o.entityId,
						status: 'accepted',
						revision,
						changeSeq: Number(s.seq),
					};
					await tx.query('INSERT INTO operation_ledger VALUES ($1,$2,$3,$4)', [
						owner,
						o.operationId,
						hash,
						result,
					]);
					return result;
				}),
			);
		}
		return {results};
	}
	async changes(
		owner: string,
		after: string = '0',
		limit: string = '100',
		epoch?: unknown,
		includeBodyWeight = false,
		includeWorkoutDeletes = false,
	) {
		if (
			typeof after !== 'string' ||
			!/^(0|[1-9][0-9]*)$/.test(after) ||
			!Number.isSafeInteger(Number(after)) ||
			typeof limit !== 'string' ||
			!/^[1-9][0-9]*$/.test(limit) ||
			Number(limit) > 100
		)
			throw new BadRequestException('Invalid cursor or limit');
		const rows = await this.db.transaction(async (tx) => {
			await lockOwner(tx, owner);
			await requireEpoch(tx, owner, epoch);
			// Filter before pagination: legacy cursors remain the last visible change,
			// never a skipped record kind that their strict page validator cannot read.
			return tx.query<ChangeRow[]>(
				"SELECT * FROM changes WHERE owner_id=$1 AND seq>$2 AND ($4 OR kind <> 'putBodyWeight') AND ($5 OR kind <> 'deleteWorkout') ORDER BY seq LIMIT $3",
				[owner, after, Number(limit) + 1, includeBodyWeight, includeWorkoutDeletes],
			);
		});
		const hasMore = rows.length > Number(limit);
		const page = rows.slice(0, Number(limit));
		const last = page.at(-1);
		return {
			changes: page.map((r) => ({
				entityId: r.entity_id,
				kind: r.kind,
				revision: r.revision,
				payload: r.payload,
				changeSeq: Number(r.seq),
			})),
			nextCursor: last ? Number(last.seq) : Number(after),
			hasMore,
		};
	}
}
