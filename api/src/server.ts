import { createApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Sanitrace API listening on http://localhost:${config.port}`);
  console.log(`  database: ${config.db.database} on ${config.db.host}:${config.db.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, shutting down`);
  server.close();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
