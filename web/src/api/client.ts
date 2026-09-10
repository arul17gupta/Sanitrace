import { del, get, patch, post, url } from './http';
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

/**
 * Every call this front-end makes, in one place.
 *
 * Each function is a single expression: a verb, an address, and the type that
 * comes back. The plumbing -- base URL, the `X-User-Id` header, turning a
 * failure into an `ApiError` -- lives in http.ts, so there is nothing to read
 * here except the shape of the API itself.
 *
 * | function                | call                                          | returns              |
 * |-------------------------|-----------------------------------------------|----------------------|
 * | `listUsers`             | `GET  /api/users`                             | `User[]`             |
 * | `listMethods`           | `GET  /api/cleaning-methods`                  | `CleaningMethod[]`   |
 * | `listEquipment`         | `GET  /api/equipment`                         | `Page<Equipment>`    |
 * | `getEquipment`          | `GET  /api/equipment/:id`                     | `Equipment`          |
 * | `createEquipment`       | `POST /api/equipment`                         | `Equipment`          |
 * | `updateEquipment`       | `PATCH /api/equipment/:id`                    | `Equipment`          |
 * | `retireEquipment`       | `DELETE /api/equipment/:id`                   | `Equipment`          |
 * | `listRecords`           | `GET  /api/equipment/:id/cleaning-records`    | `Page<CleaningRecord>` |
 * | `createRecord`          | `POST /api/equipment/:id/cleaning-records`    | `CleaningRecord`     |
 * | `updateRecord`          | `PATCH /api/cleaning-records/:id`             | `CleaningRecord`     |
 * | `listAudit`             | `GET  /api/cleaning-records/:id/audit`        | `Page<AuditChangeSet>` |
 *
 * Two response shapes, and the return types say which is which:
 *
 * - **Paginated** endpoints answer `{ data, nextCursor, hasMore }`, typed as
 *   `Page<T>`. The caller keeps the cursor to ask for the next page.
 * - **Reference lists** (users, methods) are short closed sets with no cursor.
 *   The API still wraps them in `{ data }` for consistency; these functions
 *   unwrap it, because a caller that can never paginate should not have to
 *   reach through an envelope.
 */

/** Filters and paging shared by the two paginated list endpoints. */
export interface PageQuery {
  cursor?: string | null;
  limit?: number;
}

export interface EquipmentQuery extends PageQuery {
  status?: EquipmentStatus;
}

export interface RecordQuery extends PageQuery {
  status?: CleaningStatus;
}

/** The fields a PATCH may carry, beyond the record's own values. */
export type RecordPatchBody = Partial<RecordDraft> & {
  status?: CleaningStatus;
  reason?: string;
};

export const api = {
  // --- reference data, for the form's dropdowns -------------------------------

  /** `GET /api/users` */
  listUsers: (): Promise<User[]> =>
    get<{ data: User[] }>('/api/users').then((body) => body.data),

  /** `GET /api/cleaning-methods` — active procedures only */
  listMethods: (): Promise<CleaningMethod[]> =>
    get<{ data: CleaningMethod[] }>('/api/cleaning-methods').then((body) => body.data),

  // --- equipment -------------------------------------------------------------

  /** `GET /api/equipment` */
  listEquipment: (query: EquipmentQuery = {}): Promise<Page<Equipment>> =>
    get(url('/api/equipment', { ...query })),

  /** `GET /api/equipment/:id` */
  getEquipment: (equipmentId: string): Promise<Equipment> =>
    get(`/api/equipment/${equipmentId}`),

  /** `POST /api/equipment` */
  createEquipment: (input: { name: string; code: string }): Promise<Equipment> =>
    post('/api/equipment', input),

  /** `PATCH /api/equipment/:id` */
  updateEquipment: (
    equipmentId: string,
    input: { name?: string; code?: string; status?: EquipmentStatus },
  ): Promise<Equipment> => patch(`/api/equipment/${equipmentId}`, input),

  /** `DELETE /api/equipment/:id` — retires it; the row is never removed */
  retireEquipment: (equipmentId: string): Promise<Equipment> =>
    del(`/api/equipment/${equipmentId}`),

  // --- cleaning records ------------------------------------------------------

  /** `GET /api/equipment/:id/cleaning-records` — newest cleaning first */
  listRecords: (equipmentId: string, query: RecordQuery = {}): Promise<Page<CleaningRecord>> =>
    get(url(`/api/equipment/${equipmentId}/cleaning-records`, { ...query })),

  /** `POST /api/equipment/:id/cleaning-records` — always created `pending` */
  createRecord: (equipmentId: string, draft: RecordDraft): Promise<CleaningRecord> =>
    post(`/api/equipment/${equipmentId}/cleaning-records`, draft),

  /**
   * `PATCH /api/cleaning-records/:id`
   *
   * Send only the fields that changed. The API audits exactly what it is
   * given, so anything included here appears in the record's audit trail --
   * see records/patch.ts, which works out the minimal body.
   */
  updateRecord: (recordId: string, body: RecordPatchBody): Promise<CleaningRecord> =>
    patch(`/api/cleaning-records/${recordId}`, body),

  /** `GET /api/cleaning-records/:id/audit` — newest edit first */
  listAudit: (recordId: string, query: PageQuery = {}): Promise<Page<AuditChangeSet>> =>
    get(url(`/api/cleaning-records/${recordId}/audit`, { ...query })),
};

// Re-exported so a component imports one module: the calls it makes and the
// error type it catches.
export { ApiError, getCurrentUserId, setCurrentUserId } from './http';
