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
    const cursor = {
      sortValue: '2026-09-01T10:00:00.000Z',
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    };
    expect(decodeCursor(encodeCursor(cursor), 'timestamp')).toEqual(cursor);
  });

  it('produces a URL-safe token', () => {
    const token = encodeCursor({
      sortValue: 'MT/003+A=',
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token, 'text').sortValue).toBe('MT/003+A=');
  });

  it('rejects a token that is not base64url JSON', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrowError(AppError);
  });

  it('rejects a token whose JSON is the wrong shape', () => {
    const tampered = Buffer.from(JSON.stringify({ sortValue: 5 }), 'utf8').toString('base64url');
    try {
      decodeCursor(tampered, 'timestamp');
      expect.unreachable('expected an invalid-cursor failure');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_CURSOR');
      expect((error as AppError).status).toBe(400);
    }
  });
});

describe('cursor validation against the query that will consume it', () => {
  const UUID = '11111111-1111-4111-8111-111111111111';
  const mint = (sortValue: string, id: string) => encodeCursor({ sortValue, id });

  it('accepts a timestamp cursor for a timestamp-ordered collection', () => {
    const cursor = mint('2026-09-01T10:00:00.000Z', UUID);
    expect(decodeCursor(cursor, 'timestamp')).toEqual({
      sortValue: '2026-09-01T10:00:00.000Z',
      id: UUID,
    });
  });

  it('rejects a cursor minted by another collection', () => {
    // Every cursor is a pair of strings, so an equipment cursor -- whose
    // sortValue is an asset tag -- decodes cleanly against the cleaning log.
    // The query then casts it to timestamptz and Postgres raises, which used to
    // surface as a 500 for what is really a bad request.
    const equipmentCursor = mint('MT-003', UUID);

    expect(decodeCursor(equipmentCursor, 'text')).toEqual({ sortValue: 'MT-003', id: UUID });

    try {
      decodeCursor(equipmentCursor, 'timestamp');
      expect.unreachable('expected a cross-collection cursor to be rejected');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_CURSOR');
      expect((error as AppError).status).toBe(400);
    }
  });

  it('rejects a cursor whose id is not a uuid', () => {
    // The tie-breaker is cast to uuid in the query.
    for (const kind of ['timestamp', 'text'] as const) {
      expect(() => decodeCursor(mint('2026-09-01T10:00:00.000Z', 'not-a-uuid'), kind)).toThrowError(
        AppError,
      );
    }
  });

  it('rejects an unparseable timestamp', () => {
    expect(() => decodeCursor(mint('yesterday-ish', UUID), 'timestamp')).toThrowError(AppError);
  });

  it('rejects an asset tag that Date.parse would happily accept', () => {
    // The reason this check is a strict ISO pattern and not a NaN test:
    // Date.parse('MT-003') returns a real timestamp, because V8's fallback
    // parser reads '003' as a year. A NaN check lets asset tags straight
    // through to the ::timestamptz cast.
    expect(Number.isNaN(Date.parse('MT-003'))).toBe(false);
    expect(() => decodeCursor(mint('MT-003', UUID), 'timestamp')).toThrowError(AppError);
    expect(() => decodeCursor(mint('BLN-005', UUID), 'timestamp')).toThrowError(AppError);
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
    { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', at: '2026-09-03T00:00:00.000Z' },
    { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', at: '2026-09-02T00:00:00.000Z' },
    { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3303', at: '2026-09-01T00:00:00.000Z' },
  ];
  const toCursor = (row: { id: string; at: string }) => ({ sortValue: row.at, id: row.id });

  it('trims the lookahead row and reports more', () => {
    // The query fetches limit + 1 rows: the extra row is how hasMore is known
    // without a second COUNT(*), which on a large log would cost more than the
    // page itself.
    const page = buildPage(rows, 2, toCursor);

    expect(page.data.map((r) => r.at)).toEqual([
      '2026-09-03T00:00:00.000Z',
      '2026-09-02T00:00:00.000Z',
    ]);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor as string, 'timestamp')).toEqual({
      sortValue: '2026-09-02T00:00:00.000Z',
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
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
    page.data.push({
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3304',
      at: '2026-08-31T00:00:00.000Z',
    });

    expect(source).toHaveLength(2);
  });
});
