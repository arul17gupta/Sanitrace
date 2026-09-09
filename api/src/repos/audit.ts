import { query } from '../db.js';
import { buildPage, type Cursor } from '../pagination.js';
import type { AuditChangeSet, AuditFieldEntry, Page } from '../types.js';

interface ChangeSetRow {
  id: string;
  record_id: string;
  action: 'create' | 'update';
  reason: string | null;
  changed_by: string;
  changed_by_name: string;
  changed_at: string;
}

interface EntryRow {
  id: number;
  change_set_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
}

export interface ListAuditOptions {
  recordId: string;
  limit: number;
  cursor?: Cursor | undefined;
}

/**
 * The audit history for one record, newest edit first.
 *
 * Paginated with the same keyset helper as the record list: the audit trail is
 * the fastest-growing table in the schema, so it is the last place that should
 * be read with an unbounded query.
 *
 * Entries are fetched in a second statement keyed by the ids on this page,
 * rather than one query per change set. Two round trips regardless of page
 * size, and no entries are read for the lookahead row that pagination
 * discards.
 */
export async function listAuditHistory(options: ListAuditOptions): Promise<Page<AuditChangeSet>> {
  const headerRows = await query<ChangeSetRow>(
    `select cs.id, cs.record_id, cs.action, cs.reason,
            cs.changed_by, u.name as changed_by_name, cs.changed_at
     from audit_change_sets cs
     join users u on u.id = cs.changed_by
     where cs.record_id = $1
       and ($2::timestamptz is null or (cs.changed_at, cs.id) < ($2::timestamptz, $3::uuid))
     order by cs.changed_at desc, cs.id desc
     limit $4`,
    [
      options.recordId,
      options.cursor?.sortValue ?? null,
      options.cursor?.id ?? null,
      options.limit + 1,
    ],
  );

  const page = buildPage(headerRows, options.limit, (row) => ({
    sortValue: row.changed_at,
    id: row.id,
  }));

  const entriesByChangeSet = await loadEntries(page.data.map((row) => row.id));

  return {
    data: page.data.map((row) => ({
      id: row.id,
      recordId: row.record_id,
      action: row.action,
      reason: row.reason,
      changedBy: row.changed_by,
      changedByName: row.changed_by_name,
      changedAt: row.changed_at,
      entries: entriesByChangeSet.get(row.id) ?? [],
    })),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

async function loadEntries(changeSetIds: readonly string[]): Promise<Map<string, AuditFieldEntry[]>> {
  const grouped = new Map<string, AuditFieldEntry[]>();
  if (changeSetIds.length === 0) return grouped;

  const rows = await query<EntryRow>(
    `select id, change_set_id, field, old_value, new_value
     from audit_entries
     where change_set_id = any($1::uuid[])
     order by change_set_id, id`,
    [changeSetIds],
  );

  for (const row of rows) {
    const bucket = grouped.get(row.change_set_id);
    const entry: AuditFieldEntry = {
      id: row.id,
      field: row.field,
      oldValue: row.old_value,
      newValue: row.new_value,
    };
    if (bucket === undefined) {
      grouped.set(row.change_set_id, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  return grouped;
}
