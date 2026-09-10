import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, get, patch, post, setCurrentUserId, url } from './http';

/**
 * These tests are also the documentation for the transport: what a request
 * looks like on the wire, and what a failure turns into.
 */

const BASE = 'http://localhost:4000';

/** Replies with a JSON body and the given status. */
function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const fetchMock = vi.fn<(path: string, init: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setCurrentUserId(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentUserId(null);
});

/** The (path, init) pair the last call passed to fetch. */
function lastCall(): { path: string; init: RequestInit; headers: Headers } {
  const call = fetchMock.mock.calls[0];
  if (call === undefined) throw new Error('fetch was not called');
  const [path, init] = call;
  return { path, init, headers: new Headers(init.headers) };
}

describe('url', () => {
  it('returns the bare path when there is no query', () => {
    expect(url('/api/equipment')).toBe('/api/equipment');
    expect(url('/api/equipment', {})).toBe('/api/equipment');
  });

  it('drops values that mean "not set" rather than sending them empty', () => {
    // An absent filter must not become `?status=`, which the API would then
    // have to interpret.
    expect(url('/api/equipment', { status: undefined, cursor: null, limit: '' })).toBe(
      '/api/equipment',
    );
  });

  it('appends only the values that are set', () => {
    expect(url('/api/equipment', { status: 'active', limit: 20 })).toBe(
      '/api/equipment?status=active&limit=20',
    );
  });

  it('encodes a cursor safely', () => {
    // Cursors are base64url so they are already safe, but a `+` or `=` from
    // any other source must not corrupt the query.
    expect(url('/api/x', { cursor: 'a+b/c=' })).toBe('/api/x?cursor=a%2Bb%2Fc%3D');
  });
});

describe('sending a request', () => {
  it('prefixes the base URL', async () => {
    fetchMock.mockResolvedValue(reply(200, { data: [] }));
    await get('/api/users');
    expect(lastCall().path).toBe(`${BASE}/api/users`);
  });

  it('omits X-User-Id when no user is acting', async () => {
    fetchMock.mockResolvedValue(reply(200, {}));
    await get('/api/users');
    expect(lastCall().headers.has('X-User-Id')).toBe(false);
  });

  it('attaches X-User-Id once a user is acting', async () => {
    // Set in one place, so no endpoint can forget it.
    setCurrentUserId('11111111-1111-4111-8111-111111111111');
    fetchMock.mockResolvedValue(reply(200, {}));
    await get('/api/users');
    expect(lastCall().headers.get('X-User-Id')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('sends a JSON body and content type on a write', async () => {
    fetchMock.mockResolvedValue(reply(201, { id: 'r1' }));
    await post('/api/equipment', { name: 'Rig', code: 'RIG-1' });

    const { init, headers } = lastCall();
    expect(init.method).toBe('POST');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'Rig', code: 'RIG-1' }));
  });

  it('sends no content type on a read', async () => {
    fetchMock.mockResolvedValue(reply(200, {}));
    await get('/api/users');
    expect(lastCall().headers.has('Content-Type')).toBe(false);
  });

  it('returns the parsed body on success', async () => {
    fetchMock.mockResolvedValue(reply(200, { data: [{ id: 'u1' }] }));
    await expect(get('/api/users')).resolves.toEqual({ data: [{ id: 'u1' }] });
  });
});

describe('turning a failure into an ApiError', () => {
  it('carries the status, code, message and details', async () => {
    fetchMock.mockResolvedValue(
      reply(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request body or query is invalid',
          details: { cleanedAt: ['cleanedAt cannot be in the future'] },
        },
      }),
    );

    const caught = await patch('/api/cleaning-records/r1', {}).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiError);
    const error = caught as ApiError;
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    // `code` is what callers branch on; the message is free to be reworded.
    expect(error.fieldError('cleanedAt')).toBe('cleanedAt cannot be in the future');
    expect(error.fieldError('notes')).toBeUndefined();
  });

  it('falls back when the body is not the API error shape', async () => {
    // A proxy or a crash can reply with HTML, which json() rejects on.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not json')),
    } as Response);

    const error = (await get('/api/users').catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toContain('502');
  });

  it('reports a domain rule with its code so the UI can react to it', async () => {
    fetchMock.mockResolvedValue(
      reply(409, {
        error: {
          code: 'SELF_VERIFICATION_FORBIDDEN',
          message: 'A cleaning record cannot be verified by the person who performed the cleaning.',
        },
      }),
    );

    const error = (await patch('/api/cleaning-records/r1', { status: 'verified' }).catch(
      (caught: unknown) => caught,
    )) as ApiError;

    expect(error.code).toBe('SELF_VERIFICATION_FORBIDDEN');
    expect(error.status).toBe(409);
  });
});
