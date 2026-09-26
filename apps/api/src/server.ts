import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabasePool, databaseReady } from './db/pool.js';

const config = loadConfig();
const pool = createDatabasePool(config);
if (!await databaseReady(pool)) {
  await pool.end();
  throw new Error('PostgreSQL is unavailable');
}

const server = createServer(createApp(config, pool));
server.requestTimeout = 15_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, '0.0.0.0', () => {
  console.info(JSON.stringify({ level: 'info', event: 'api_started', port: config.port }));
});

let stopping = false;
async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ level: 'info', event: 'api_stopping', reason }));
  const forced = setTimeout(() => process.exit(1), 10_000);
  forced.unref();
  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  clearTimeout(forced);
  process.exit(exitCode);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('uncaughtException', (error) => {
  console.error(JSON.stringify({ level: 'fatal', event: 'uncaught_exception', errorName: error.name }));
  void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (error) => {
  console.error(JSON.stringify({ level: 'fatal', event: 'unhandled_rejection', errorName: error instanceof Error ? error.name : 'UnknownError' }));
  void shutdown('unhandledRejection', 1);
});
