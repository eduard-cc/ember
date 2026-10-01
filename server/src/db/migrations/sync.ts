import {MigrationInterface, QueryRunner} from 'typeorm';

export class Sync1790850000001 implements MigrationInterface {
	async up(q: QueryRunner) {
		await q.query(`
 CREATE TABLE owner_sequences (owner_id text PRIMARY KEY, seq bigint NOT NULL DEFAULT 0);
 CREATE TABLE records (owner_id text NOT NULL, entity_id text NOT NULL, kind text NOT NULL, revision integer NOT NULL, payload jsonb, PRIMARY KEY(owner_id,entity_id));
 CREATE TABLE changes (owner_id text NOT NULL, seq bigint NOT NULL, entity_id text NOT NULL, kind text NOT NULL, revision integer NOT NULL, payload jsonb, PRIMARY KEY(owner_id,seq));
 `);
	}
	async down(q: QueryRunner) {
		await q.query('DROP TABLE changes, records, owner_sequences');
	}
}
