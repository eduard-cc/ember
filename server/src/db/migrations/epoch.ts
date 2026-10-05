import {MigrationInterface, QueryRunner} from 'typeorm';

/** One dataset epoch per owner. A reset rotates it so stale installations stop syncing. */
export class Epoch1790850000003 implements MigrationInterface {
	async up(q: QueryRunner) {
		await q.query('CREATE TABLE dataset_epochs (owner_id text PRIMARY KEY, epoch text NOT NULL)');
	}
	async down(q: QueryRunner) {
		await q.query('DROP TABLE dataset_epochs');
	}
}
