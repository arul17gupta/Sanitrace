import { query, type Queryable } from '../db.js';
import { buildPage, type Cursor } from '../pagination.js';
import type { AuditableValues } from '../audit/diff.js';
import type { CleaningRecord, CleaningStatus, Page } from '../types.js';

interface RecordRow {
  id: string;
  equipment_id: string;
  cleaned_by: string;
  cleaned_by_name: string;
  cleaned_at: string;
  method_id: string;
  method_code: string;
  method_name: string;
  notes: string | null;
  status: CleaningStatus;
  created_at: string;
  updated_at: string;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
}

const RECORD_COLUMNS = `
    r.id, r.equipment_id, r.cleaned_by, cu.name as cleaned_by_name,
    r.cleaned_at, r.method_id, m.code as method_code, m.name as method_name,
    r.notes, r.status, r.created_at, r.updated_at,
    v.changed_by as verified_by, v.verifier_name as verified_by_name,
    v.changed_at as verified_at`;

/**
 * `verifiedBy` / `verifiedAt` are read out of the audit trail rather than
 * stored on the record: the trail already knows who moved the record to
 * `verified` and when, and a duplicate column could drift away from it.
 *
 * The lateral join is gated by `on r.status = 'verified'`, so a record that was
 * verified and later reverted reports no verifier -- the stale sign-off must
 * not be presented as current.
 */
const RECORD_FROM = `
  from cleaning_records r
  join cleaning_methods m on m.id = r.method_id
  join users cu           on cu.id = r.cleaned_by
  left join lateral (
      select cs.changed_by, cs.changed_at, vu.name as verifier_name
      from audit_change_sets cs
      join audit_entries ae on ae.change_set_id = cs.id
      join users vu         on vu.id = cs.changed_by
      where cs.record_id = r.id
        and ae.field = 'status'
        and ae.new_value = 'verified'
      order by cs.changed_at desc, cs.id desc
      limit 1
  ) v on r.status = 'verified'`;

const toRecord = (row: RecordRow): CleaningRecord => ({
  id: row.id,
  equipmentId: row.equipment_id,
  cleanedBy: row.cleaned_by,
  cleanedByName: row.cleaned_by_name,
  cleanedAt: row.cleaned_at,
  methodId: row.method_id,
  methodCode: row.method_code,
  methodName: row.method_name,
  notes: row.notes,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  verifiedBy: row.verified_by,
  verifiedByName: row.verified_by_name,
  verifiedAt: row.verified_at,
});

/**
 * The projection the audit diff works on: display strings, not raw columns.
 *
 * A method appears as its SOP code and a user as their name, because the trail
 * is read by a person who must not have to resolve a uuid to understand what
 * changed.
 */
export function auditableProjection(record: CleaningRecord): AuditableValues {
  return {
    cleanedBy: record.cleanedByName,
    cleanedAt: record.cleanedAt,
    method: record.methodCode,
    notes: record.notes,
    status: record.status,
  };
}

export interface ListRecordsOptions {
  equipmentId: string;
  status?: CleaningStatus | undefined;
  limit: number;
  cursor?: Cursor | undefined;
}

/**
 * Newest cleaning first, which is the order the log is read in.
 *
 * `(cleaned_at, id) < ($3, $4)` is the whole of keyset pagination: row
 * comparison turns the composite sort key into a single strict ordering, and it
 * matches `cleaning_records_page_idx` exactly, so each page is an index range
 * scan regardless of how deep into the log it sits.
 */
export async function listRecordsByEquipment(
  options: ListRecordsOptions,
): Promise<Page<CleaningRecord>> {
  const rows = await query<RecordRow>(
    `select ${RECORD_COLUMNS}
     ${RECORD_FROM}
     where r.equipment_id = $1
       and ($2::cleaning_status is null or r.status = $2)
       and ($3::timestamptz is null or (r.cleaned_at, r.id) < ($3::timestamptz, $4::uuid))
     order by r.cleaned_at desc, r.id desc
     limit $5`,
    [
      options.equipmentId,
      options.status ?? null,
      options.cursor?.sortValue ?? null,
      options.cursor?.id ?? null,
      options.limit + 1,
    ],
  );

  return buildPage(rows.map(toRecord), options.limit, (item) => ({
    sortValue: item.cleanedAt,
    id: item.id,
  }));
}

export async function findRecord(
  id: string,
  client?: Queryable,
): Promise<CleaningRecord | null> {
  const sql = `select ${RECORD_COLUMNS} ${RECORD_FROM} where r.id = $1`;
  const rows = client
    ? (await client.query<RecordRow>(sql, [id])).rows
    : await query<RecordRow>(sql, [id]);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

/**
 * Takes a row lock before an amendment is read and rewritten.
 *
 * Without it, two concurrent edits could each read the same "before" state and
 * each write an audit entry claiming to have changed the same original value --
 * the trail would then be a plausible-looking lie. Returns false when the
 * record does not exist.
 */
export async function lockRecord(client: Queryable, id: string): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `select id from cleaning_records where id = $1 for update`,
    [id],
  );
  return result.rows.length > 0;
}

export interface InsertRecordInput {
  equipmentId: string;
  cleanedBy: string;
  cleanedAt: string;
  methodId: string;
  notes?: string | null;
}

/**
 * A new record is always `pending`.
 *
 * Allowing a caller to create an already-verified record would let one person
 * both perform and approve a cleaning in a single request, which is exactly
 * what the four-eyes rule exists to prevent.
 */
export async function insertRecord(
  client: Queryable,
  input: InsertRecordInput,
): Promise<CleaningRecord> {
  const inserted = await client.query<{ id: string }>(
    `insert into cleaning_records (equipment_id, cleaned_by, cleaned_at, method_id, notes, status)
     values ($1, $2, $3, $4, $5, 'pending')
     returning id`,
    [input.equipmentId, input.cleanedBy, input.cleanedAt, input.methodId, input.notes ?? null],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error('Insert returned no row');

  const record = await findRecord(id, client);
  if (record === null) throw new Error('Inserted record could not be read back');
  return record;
}

export interface UpdateRecordInput {
  cleanedBy?: string | undefined;
  cleanedAt?: string | undefined;
  methodId?: string | undefined;
  /** Present-but-undefined means "leave alone"; `null` means "clear". */
  notes?: string | null | undefined;
  notesProvided: boolean;
  status: CleaningStatus;
}

export async function updateRecord(
  client: Queryable,
  id: string,
  input: UpdateRecordInput,
): Promise<CleaningRecord> {
  await client.query(
    `update cleaning_records
        set cleaned_by = coalesce($2::uuid, cleaned_by),
            cleaned_at = coalesce($3::timestamptz, cleaned_at),
            method_id  = coalesce($4::uuid, method_id),
            notes      = case when $5::boolean then $6::varchar else notes end,
            status     = $7::cleaning_status,
            updated_at = now()
      where id = $1`,
    [
      id,
      input.cleanedBy ?? null,
      input.cleanedAt ?? null,
      input.methodId ?? null,
      input.notesProvided,
      input.notes ?? null,
      input.status,
    ],
  );

  const record = await findRecord(id, client);
  if (record === null) throw new Error('Updated record could not be read back');
  return record;
}
