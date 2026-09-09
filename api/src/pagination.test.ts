import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildPage,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from './pagination.js';

describe('cursor encoding', () => {
  it('round-trips a cursor', () => {
    const cursor = { sortValue: '2026-09-01T10:00:00.000Z', id: 'abc-123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('produces a URL-safe token', () => {
    const token = encodeCursor({ sortValue: '2026-09-01T10:00:00.000Z', id: 'a/b+c=' });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token).id).toBe('a/b+c=');
  });

  it('rejects a token that is not base64url JSON', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrowError(AppError);
  });

  it('rejects a token whose JSON is the wrong shape', () => {
    const tampered = Buffer.from(JSON.stringify({ sortValue: 5 }), 'utf8').toString('base64url');
    try {
      decodeCursor(tampered);
      expect.unreachable('expected an invalid-cursor failure');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_CURSOR');
      expect((error as AppError).status).toBe(400);
    }
  });
});

describe('parseLimit', () => {
  it('defaults when absent or unusable', () => {
    for (const raw of [undefined, null, '', 'abc', Number.NaN]) {
      expect(parseLimit(raw)).toBe(DEFAULT_LIMIT);
    }
  });

  it('clamps rather than rejecting, so a caller cannot ask for unbounded work', () => {
    expect(parseLimit('10000')).toBe(MAX_LIMIT);
    expect(parseLimit('0')).toBe(1);
    expect(parseLimit('-5')).toBe(1);
  });

  it('accepts a value in range', () => {
    expect(parseLimit('5')).toBe(5);
    expect(parseLimit(25)).toBe(25);
  });
});

describe('buildPage', () => {
  const rows = [
    { id: 'a', at: '2026-09-03T00:00:00.000Z' },
    { id: 'b', at: '2026-09-02T00:00:00.000Z' },
    { id: 'c', at: '2026-09-01T00:00:00.000Z' },
  ];
  const toCursor = (row: { id: string; at: string }) => ({ sortValue: row.at, id: row.id });

  it('trims the lookahead row and reports more', () => {
    // The query fetches limit + 1 rows: the extra row is how hasMore is known
    // without a second COUNT(*), which on a large log would cost more than the
    // page itself.
    const page = buildPage(rows, 2, toCursor);

    expect(page.data.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor as string)).toEqual({
      sortValue: '2026-09-02T00:00:00.000Z',
      id: 'b',
    });
  });

  it('reports no more and no cursor on the last page', () => {
    const page = buildPage(rows, 3, toCursor);

    expect(page.data).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('handles an empty result', () => {
    expect(buildPage([], 20, toCursor)).toEqual({ data: [], hasMore: false, nextCursor: null });
  });

  it('does not alias the caller array', () => {
    const source = rows.slice(0, 2);
    const page = buildPage(source, 5, toCursor);
    page.data.push({ id: 'd', at: '2026-08-31T00:00:00.000Z' });

    expect(source).toHaveLength(2);
  });
});
