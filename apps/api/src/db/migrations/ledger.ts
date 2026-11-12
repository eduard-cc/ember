import {MigrationInterface, QueryRunner} from 'typeorm';

export class Ledger1790850000002 implements MigrationInterface {
	async up(q: QueryRunner) {
		await q.query(
			'CREATE TABLE operation_ledger (owner_id text NOT NULL, operation_id uuid NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(owner_id,operation_id))',
		);
	}
	async down(q: QueryRunner) {
		await q.query('DROP TABLE operation_ledger');
	}
}
