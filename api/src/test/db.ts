import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

const dbDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db');

/**
 * Brings the test database to a known state.
 *
 * Re-applies schema.sql (which drops and recreates) rather than truncating, so
 * every run also re-asserts the append-only triggers -- a test that relies on
 * them cannot silently pass against a database where they are missing.
 *
 * config.db.database already resolves to the test database when VITEST is set,
 * so the pool used by the app under test points here too.
 */
export async function resetTestDatabase(): Promise<void> {
  if (!config.isTest) {
    throw new Error('resetTestDatabase must only run with VITEST or NODE_ENV=test set');
  }
  if (config.db.testDatabase === config.db.appDatabase) {
    throw new Error(
      'TEST_PGDATABASE must differ from PGDATABASE: the tests drop every table they find',
    );
  }

  await ensureTestDatabaseExists();

  const client = new pg.Client({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.testDatabase,
  });

  await client.connect();
  try {
    await client.query(await readFile(resolve(dbDir, 'schema.sql'), 'utf8'));
    await client.query(await readFile(resolve(dbDir, 'seed.sql'), 'utf8'));
  } finally {
    await client.end();
  }
}

async function ensureTestDatabaseExists(): Promise<void> {
  const admin = new pg.Client({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: 'postgres',
  });

  await admin.connect();
  try {
    const existing = await admin.query(`select 1 from pg_database where datname = $1`, [
      config.db.testDatabase,
    ]);
    if (existing.rows.length === 0) {
      await admin.query(`create database "${config.db.testDatabase.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }
}
