import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

/**
 * Creates the database if it does not exist, applies db/schema.sql, then
 * db/seed.sql.
 *
 * Written in Node rather than as a psql invocation so that `npm run db:setup`
 * behaves the same on Windows and on a POSIX shell, and so it reuses exactly
 * the connection settings the API itself uses -- if setup works, the API can
 * connect.
 *
 *   npm run db:setup              # app database, schema + seed
 *   npm run db:setup -- --test    # the test database
 *   npm run db:setup -- --no-seed # schema only
 */

const here = dirname(fileURLToPath(import.meta.url));
const dbDir = resolve(here, '../../../db');

const args = new Set(process.argv.slice(2));
const useTestDatabase = args.has('--test');
const skipSeed = args.has('--no-seed');

const targetDatabase = useTestDatabase ? config.db.testDatabase : config.db.appDatabase;

const baseConnection = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
};

async function ensureDatabase(): Promise<boolean> {
  // Connect to the maintenance database: you cannot CREATE DATABASE from
  // inside the database you are creating.
  const admin = new pg.Client({ ...baseConnection, database: 'postgres' });
  await admin.connect();
  try {
    const existing = await admin.query<{ datname: string }>(
      `select datname from pg_database where datname = $1`,
      [targetDatabase],
    );

    if (existing.rows.length > 0) return false;

    // Identifiers cannot be parameterized, so the name is quoted instead. It
    // comes from the local .env, not from a request.
    await admin.query(`create database "${targetDatabase.replace(/"/g, '""')}"`);
    return true;
  } finally {
    await admin.end();
  }
}

async function applyFile(client: pg.Client, name: string): Promise<void> {
  const sql = await readFile(resolve(dbDir, name), 'utf8');
  await client.query(sql);
  console.log(`  applied ${name}`);
}

async function main(): Promise<void> {
  console.log(`Setting up ${targetDatabase} on ${config.db.host}:${config.db.port}`);

  const created = await ensureDatabase();
  console.log(created ? `  created database ${targetDatabase}` : `  database already exists`);

  const client = new pg.Client({ ...baseConnection, database: targetDatabase });
  await client.connect();
  try {
    await applyFile(client, 'schema.sql');
    if (skipSeed) {
      console.log('  skipped seed.sql (--no-seed)');
    } else {
      await applyFile(client, 'seed.sql');
    }
  } finally {
    await client.end();
  }

  console.log('Done.');
}

main().catch((error: unknown) => {
  console.error('\nDatabase setup failed:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
