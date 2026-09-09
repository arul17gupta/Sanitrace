import type { Queryable } from '../db.js';
import type { FieldChange } from './diff.js';

export interface WriteAuditInput {
  recordId: string;
  action: 'create' | 'update';
  /** The user making the change -- the "who" of the audit entry. */
  actorId: string;
  reason?: string | null;
  changes: readonly FieldChange[];
  /** Overrides `now()`; only used to keep tests deterministic. */
  changedAt?: string;
}

/**
 * Persists one change set and its field entries.
 *
 * Always called with the same client as the record write, inside the same
 * transaction, so a record and the trail that explains it commit together or
 * not at all.
 *
 * Returns the change-set id, or `null` when there was nothing to record -- an
 * edit that changes no value must leave no trace, otherwise the trail fills
 * with entries that an inspector cannot act on.
 */
export async function writeAudit(
  client: Queryable,
  input: WriteAuditInput,
): Promise<string | null> {
  if (input.changes.length === 0) return null;

  const changeSet = await client.query<{ id: string }>(
    `insert into audit_change_sets (record_id, action, reason, changed_by, changed_at)
     values ($1, $2, $3, $4, coalesce($5::timestamptz, now()))
     returning id`,
    [input.recordId, input.action, input.reason ?? null, input.actorId, input.changedAt ?? null],
  );

  const changeSetId = changeSet.rows[0]?.id;
  if (changeSetId === undefined) {
    throw new Error('Failed to create audit change set');
  }

  // One statement for every field, unnesting three parallel arrays. Keeps the
  // write to a single round trip while staying fully parameterized.
  await client.query(
    `insert into audit_entries (change_set_id, field, old_value, new_value)
     select $1, f.field, f.old_value, f.new_value
     from unnest($2::varchar[], $3::varchar[], $4::varchar[])
          as f(field, old_value, new_value)`,
    [
      changeSetId,
      input.changes.map((c) => c.field),
      input.changes.map((c) => c.oldValue),
      input.changes.map((c) => c.newValue),
    ],
  );

  return changeSetId;
}
