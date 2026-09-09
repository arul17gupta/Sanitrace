import { AppError } from './errors.js';
import type { Page } from './types.js';

/**
 * Keyset (cursor) pagination.
 *
 * Offset pagination is wrong for this data. A cleaning log is append-heavy and
 * read newest-first, so a row inserted while a reader is paging shifts every
 * subsequent offset by one -- the reader silently sees a row twice and misses
 * another. `OFFSET n` also makes the database walk and discard n rows, so page
 * 500 costs 500 pages of work.
 *
 * A cursor instead names the last row seen, and the next page is "everything
 * strictly after this one" in a total ordering. Cost is constant per page and
 * the result set is stable under concurrent inserts.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface Cursor {
  /** The value of the leading sort column for the last row of the previous page. */
  sortValue: string;
  /** The row's id, which breaks ties and makes the ordering total. */
  id: string;
}

/**
 * Cursors are opaque on purpose: the client must not build one, because its
 * shape is a detail of the query's ORDER BY and we want to be free to change
 * it without breaking callers.
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid.');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Cursor).sortValue !== 'string' ||
    typeof (parsed as Cursor).id !== 'string'
  ) {
    throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid.');
  }

  return { sortValue: (parsed as Cursor).sortValue, id: (parsed as Cursor).id };
}

/**
 * Clamped rather than rejected: a caller asking for 10,000 rows gets the
 * maximum page instead of an error, but can never make the database do
 * unbounded work.
 */
export function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

/**
 * Turns `limit + 1` fetched rows into a page.
 *
 * Fetching one extra row is how `hasMore` is known without a second
 * `COUNT(*)` query -- which on a large log would cost more than the page
 * itself, and would be a lie by the time it was returned anyway.
 */
export function buildPage<T>(
  rows: readonly T[],
  limit: number,
  toCursor: (row: T) => Cursor,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows.slice();
  const last = data[data.length - 1];

  return {
    data,
    hasMore,
    nextCursor: hasMore && last !== undefined ? encodeCursor(toCursor(last)) : null,
  };
}
