import pg from 'pg';
import type { AppConfig } from '../config.js';

const { Pool } = pg;

export type DatabasePool = pg.Pool;

export function createDatabasePool(config: AppConfig): DatabasePool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    statement_timeout: 5_000,
    query_timeout: 10_000,
    allowExitOnIdle: config.nodeEnv !== 'production',
    application_name: 'rizzoma-api'
  });
  pool.on('error', (error) => {
    console.error(JSON.stringify({ level: 'error', event: 'postgres_idle_client_error', errorName: error.name }));
  });
  return pool;
}

export async function databaseReady(pool: DatabasePool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
