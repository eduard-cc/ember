import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * Sets no longer carry the `excluded`/`suspicious` review flags: drop them from every stored
 * workout and template, current and past revisions alike. Revisions are unchanged, because
 * clients drop the same keys from their local copies; nothing else in a document changes.
 */
const strip = (table: string) => `
UPDATE ${table} SET payload = jsonb_set(payload, '{exercises}', (
  SELECT coalesce(jsonb_agg(
    CASE WHEN jsonb_typeof(e->'sets') = 'array' THEN jsonb_set(e, '{sets}', (
      SELECT coalesce(jsonb_agg(
        CASE WHEN jsonb_typeof(s) = 'object' THEN s - 'excluded' - 'suspicious' ELSE s END
        ORDER BY si), '[]'::jsonb)
      FROM jsonb_array_elements(e->'sets') WITH ORDINALITY AS sets(s, si)))
    ELSE e END
    ORDER BY ei), '[]'::jsonb)
  FROM jsonb_array_elements(payload->'exercises') WITH ORDINALITY AS exercises(e, ei)))
WHERE jsonb_typeof(payload->'exercises') = 'array'
  AND jsonb_path_exists(payload, '$.exercises[*].sets[*] ? (exists(@.excluded) || exists(@.suspicious))')`;

export class RetiredSetFlags1790850000004 implements MigrationInterface {
	async up(q: QueryRunner) {
		await q.query(strip('records'));
		await q.query(strip('changes'));
	}
	async down() {
		// The flags are gone for good; nothing reads them any more.
	}
}
