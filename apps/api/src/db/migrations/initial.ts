import {MigrationInterface, QueryRunner} from 'typeorm';

export class Initial1790850000000 implements MigrationInterface {
	async up(q: QueryRunner) {
		await q.query(`CREATE TABLE sessions (token_hash text PRIMARY KEY, owner_id text NOT NULL, csrf text NOT NULL, expires_at timestamptz NOT NULL);
   CREATE INDEX sessions_expiry ON sessions(expires_at);`);
	}
	async down(q: QueryRunner) {
		await q.query('DROP TABLE sessions');
	}
}
