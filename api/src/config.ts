import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));

// One .env at the repository root serves both workspaces, so there is a single
// place to put credentials.
dotenv.config({ path: resolve(here, '../../.env') });

/**
 * Integration tests run against a throwaway database so they can truncate
 * freely. Vitest sets VITEST; NODE_ENV is honoured too for anyone running the
 * suite by hand.
 */
const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

const appDatabase = required('PGDATABASE', 'sanitrace');
const testDatabase = process.env.TEST_PGDATABASE ?? `${appDatabase}_test`;

export const config = {
  isTest,
  db: {
    host: required('PGHOST', 'localhost'),
    port: Number(required('PGPORT', '5432')),
    user: required('PGUSER', 'postgres'),
    password: required('PGPASSWORD'),
    /** The database the pool connects to. */
    database: isTest ? testDatabase : appDatabase,
    appDatabase,
    testDatabase,
  },
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
} as const;
