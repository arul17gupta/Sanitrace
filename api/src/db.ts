import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

/**
 * `timestamptz` arrives as a JS Date by default. The API speaks ISO-8601
 * strings end to end, and the audit trail stores the string form, so parsing
 * to Date and back would only add a place for the two to drift.
 */
const TIMESTAMPTZ_OID = 1184;
pg.types.setTypeParser(TIMESTAMPTZ_OID, (value: string) => new Date(value).toISOString());

/** `bigserial` arrives as a string to avoid precision loss; audit ids fit in a number. */
const INT8_OID = 20;
pg.types.setTypeParser(INT8_OID, (value: string) => Number(value));

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: 10,
});

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown[]);
  return result.rows;
}

/**
 * Runs `fn` inside a transaction on a single client.
 *
 * Every write that produces audit rows goes through this: the record change and
 * its audit entries must commit or fail together, so a record can never exist
 * without the trail that explains it.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
