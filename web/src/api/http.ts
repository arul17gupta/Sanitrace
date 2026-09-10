/**
 * The transport layer: how a request is sent, and how a failure becomes an
 * error object. It knows nothing about Sanitrace's endpoints -- those live in
 * client.ts.
 *
 * Everything here exists so that each endpoint in client.ts can be a one-liner
 * naming a verb and a path, with no room to get the plumbing wrong in one
 * place and right in another.
 */

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

/**
 * The acting user, sent as `X-User-Id` on every request.
 *
 * Module state rather than React context, because there is exactly one acting
 * user per browser tab and every request needs it -- threading it through each
 * call site would add noise without adding safety. This is the single seam a
 * real session or bearer token would replace: nothing outside this file knows
 * how a request proves who it is.
 */
let actingUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  actingUserId = id;
}

export function getCurrentUserId(): string | null {
  return actingUserId;
}

/**
 * Mirrors the API's single error shape:
 *
 *   { "error": { "code": "REASON_REQUIRED", "message": "...", "details": {...} } }
 *
 * `code` is the part callers should branch on. Matching on `message` would
 * break the moment someone rewords it.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[] | undefined>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The first validation message for a field, if the API reported one. */
  fieldError(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}

/** Query values; `null`, `undefined` and `''` are dropped rather than sent as empty. */
export type Query = Record<string, string | number | null | undefined>;

/**
 * Builds a path with a query string.
 *
 * Separate from the request so an endpoint reads as "verb, then address", and
 * so callers can pass their optional filters straight through without each one
 * having to decide whether a `?` is needed.
 */
export function url(path: string, query: Query = {}): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }

  const qs = search.toString();
  return qs === '' ? path : `${path}?${qs}`;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, string[] | undefined> };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  // Attached in exactly one place, so no endpoint can forget it.
  if (actingUserId !== null) headers.set('X-User-Id', actingUserId);

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  // Every endpoint in this API answers with a JSON body, successes included --
  // even DELETE returns the retired row -- so there is no empty-response case
  // to handle. `catch` covers a proxy or crash replying with HTML.
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const reported = (payload as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      reported?.code ?? 'UNKNOWN',
      reported?.message ?? `Request failed with ${response.status}`,
      reported?.details,
    );
  }

  return payload as T;
}

/** `GET path` */
export const get = <T>(path: string): Promise<T> => request<T>('GET', path);

/** `POST path` with a JSON body */
export const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>('POST', path, body);

/** `PATCH path` with a JSON body */
export const patch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>('PATCH', path, body);

/** `DELETE path` */
export const del = <T>(path: string): Promise<T> => request<T>('DELETE', path);
