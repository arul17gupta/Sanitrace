import type {
  AuditChangeSet,
  CleaningMethod,
  CleaningRecord,
  CleaningStatus,
  Equipment,
  EquipmentStatus,
  Page,
  RecordDraft,
  User,
} from './types';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

/**
 * The acting user, sent as X-User-Id on every request.
 *
 * Module state rather than context because there is exactly one acting user per
 * browser tab and every request needs it -- threading it through each call site
 * would add noise without adding safety. This is the seam that a real session
 * or token would replace.
 */
let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

/** Mirrors the API's single error shape so callers can react to a `code`. */
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (currentUserId !== null) headers.set('X-User-Id', currentUserId);

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? `Request failed with ${response.status}`,
      error?.details as Record<string, string[] | undefined> | undefined,
    );
  }

  return payload as T;
}

const params = (entries: Record<string, string | number | null | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
};

export const api = {
  listUsers: () => request<{ data: User[] }>('/api/users').then((r) => r.data),

  listMethods: () => request<{ data: CleaningMethod[] }>('/api/cleaning-methods').then((r) => r.data),

  listEquipment: (options: { status?: EquipmentStatus; cursor?: string | null; limit?: number }) =>
    request<Page<Equipment>>(
      `/api/equipment${params({
        status: options.status,
        cursor: options.cursor,
        limit: options.limit,
      })}`,
    ),

  listRecords: (
    equipmentId: string,
    options: { status?: CleaningStatus; cursor?: string | null; limit?: number },
  ) =>
    request<Page<CleaningRecord>>(
      `/api/equipment/${equipmentId}/cleaning-records${params({
        status: options.status,
        cursor: options.cursor,
        limit: options.limit,
      })}`,
    ),

  createRecord: (equipmentId: string, draft: RecordDraft) =>
    request<CleaningRecord>(`/api/equipment/${equipmentId}/cleaning-records`, {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  updateRecord: (
    recordId: string,
    patch: Partial<RecordDraft> & { status?: CleaningStatus; reason?: string },
  ) =>
    request<CleaningRecord>(`/api/cleaning-records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  listAudit: (recordId: string, options: { cursor?: string | null; limit?: number } = {}) =>
    request<Page<AuditChangeSet>>(
      `/api/cleaning-records/${recordId}/audit${params({
        cursor: options.cursor,
        limit: options.limit,
      })}`,
    ),
};
