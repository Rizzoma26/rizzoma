import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDatabasePool } from './pool.js';

const migrationsDirectory = fileURLToPath(new URL('../../../../db/migrations/', import.meta.url));
const advisoryLockId = 74_449_026;

const config = loadConfig();
const pool = createDatabasePool(config);
const client = await pool.connect();

try {
  await client.query('SELECT pg_advisory_lock($1)', [advisoryLockId]);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) {
    const sql = await readFile(new URL(`../../../../db/migrations/${name}`, import.meta.url), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE name = $1',
      [name]
    );
    if (existing.rowCount) {
      if (existing.rows[0]?.checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      await client.query('COMMIT');
      console.info(`applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockId]).catch(() => undefined);
  client.release();
  await pool.end();
}
