import {HttpException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {DataSource, EntityManager} from 'typeorm';
import {z} from 'zod';

import {workout} from './schema';

/** Before any reset every owner is in the implicit 'initial' epoch, which pre-epoch clients match. */
const INITIAL_EPOCH = 'initial';

export async function currentEpoch(db: DataSource | EntityManager, owner: string): Promise<string> {
	const [row] = await db.query('SELECT epoch FROM dataset_epochs WHERE owner_id=$1', [owner]);
	return row?.epoch ?? INITIAL_EPOCH;
}

/** Serializes reset and sync mutations for one owner until the transaction ends. */
export async function lockOwner(tx: EntityManager, owner: string) {
	await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [owner]);
}

/** Check only while holding the same owner lock used by reset and sync mutations. */
export async function requireEpoch(tx: EntityManager, owner: string, claimed: unknown) {
	const epoch = await currentEpoch(tx, owner);
	if ((claimed ?? INITIAL_EPOCH) !== epoch) throw new HttpException({errorCode: 'DATASET_RESET', epoch}, 409);
}

/**
 * Owner-approved destructive reset: deletes every synced record, change and ledger entry
 * for the owner, seeds imported history, and rotates the dataset epoch in one transaction.
 * Installations still on the old epoch are refused (409 DATASET_RESET) until they drop
 * their synced copies; their device-local active draft is never part of sync.
 */
export async function resetDataset(db: DataSource, owner: string, imported: unknown[]) {
	const documents = z.array(workout).parse(imported);
	if (new Set(documents.map((d) => d.id)).size !== documents.length) throw new Error('Duplicate seed identity');
	for (const d of documents) {
		const sets = d.exercises.flatMap((e) => e.sets);
		if (!sets.length || sets.some((s) => s.completed === false)) throw new Error('Seed contains an empty workout');
	}
	const epoch = randomUUID();
	await db.transaction(async (tx) => {
		await lockOwner(tx, owner);
		for (const table of ['changes', 'records', 'operation_ledger', 'owner_sequences'])
			await tx.query(`DELETE FROM ${table} WHERE owner_id=$1`, [owner]);
		await tx.query('INSERT INTO owner_sequences(owner_id, seq) VALUES ($1, 0)', [owner]);
		let seq = 0;
		for (const document of documents) {
			seq++;
			await tx.query('INSERT INTO records VALUES ($1,$2,$3,1,$4)', [
				owner,
				document.id,
				'putImportedWorkout',
				document,
			]);
			await tx.query('INSERT INTO changes VALUES ($1,$2,$3,$4,1,$5)', [
				owner,
				seq,
				document.id,
				'putImportedWorkout',
				document,
			]);
		}
		await tx.query('UPDATE owner_sequences SET seq=$2 WHERE owner_id=$1', [owner, seq]);
		await tx.query(
			'INSERT INTO dataset_epochs VALUES ($1,$2) ON CONFLICT (owner_id) DO UPDATE SET epoch=EXCLUDED.epoch',
			[owner, epoch],
		);
	});
	return {epoch, imported: documents.length};
}
