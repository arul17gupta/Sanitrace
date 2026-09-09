/**
 * Field-level audit diffing.
 *
 * This module is deliberately pure: no database, no clock, no user lookup, no
 * imports from the rest of the app. Everything the audit trail asserts about a
 * change is decided here, which means the rules can be tested exhaustively at
 * the speed of a unit test.
 *
 * Values are compared and stored as *display strings* rather than raw column
 * values. An inspector reads the trail directly, so a method must appear as
 * `SOP-CLN-014` and not as a uuid. Projection to display form happens in the
 * caller (see `repos/cleaningRecords.ts`), which keeps this file free of any
 * knowledge of the schema.
 */

export type FieldKind = 'string' | 'timestamp';

export interface FieldSpec {
  readonly name: string;
  readonly kind: FieldKind;
}

/**
 * A partial projection of a record. A key that is absent (or `undefined`) was
 * not part of the request and must not be diffed; an explicit `null` means the
 * field is being cleared and *is* a change.
 */
export type AuditableValues = Readonly<Record<string, string | null | undefined>>;

export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * The canonical stored form of a value: trimmed, with blank treated as absent.
 *
 * Trailing whitespace is not a change worth recording, and an empty string and
 * `null` mean the same thing to a reader ("no value"), so collapsing them keeps
 * the trail free of entries that say nothing.
 */
function display(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The form used for *comparison only*.
 *
 * Timestamps are compared as epoch milliseconds so that two spellings of the
 * same instant -- `2024-01-01T00:00:00Z` and `2024-01-01T00:00:00.000+00:00` --
 * do not produce a phantom change. An unparseable timestamp falls back to a
 * string comparison rather than throwing: the audit trail recording something
 * odd is strictly better than the write failing.
 */
function comparable(raw: string | null | undefined, kind: FieldKind): string | number | null {
  const value = display(raw);
  if (value === null) return null;
  if (kind === 'timestamp') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? value : ms;
  }
  return value;
}

/**
 * Computes the audit entries for one change.
 *
 * @param before `null` for a create; otherwise the record's current state.
 * @param after  The new state. Keys absent from this object are left alone,
 *               which is what makes a PATCH of one field produce exactly one
 *               audit entry.
 * @param fields The allow-list of auditable fields. Passing it in (rather than
 *               walking `Object.keys`) is what stops `updated_at`, `id` or any
 *               future bookkeeping column from leaking into the trail.
 */
export function diffRecord(
  before: AuditableValues | null,
  after: AuditableValues,
  fields: readonly FieldSpec[],
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const spec of fields) {
    const nextRaw = after[spec.name];

    // Absent from a partial patch: not a change, not an omission to record.
    if (nextRaw === undefined) continue;

    const newValue = display(nextRaw);

    if (before === null) {
      // On create there is nothing to compare against, so record every field
      // that actually holds a value. Recording `null -> null` for an empty
      // optional field would be noise.
      if (newValue !== null) {
        changes.push({ field: spec.name, oldValue: null, newValue });
      }
      continue;
    }

    const prevRaw = before[spec.name];
    if (comparable(prevRaw, spec.kind) === comparable(nextRaw, spec.kind)) continue;

    changes.push({ field: spec.name, oldValue: display(prevRaw), newValue });
  }

  return changes;
}

/**
 * The auditable projection of a cleaning record.
 *
 * `equipmentId` is absent on purpose: a cleaning record belongs to one piece of
 * equipment for its whole life, so there is no reassignment to audit.
 */
export const CLEANING_RECORD_FIELDS: readonly FieldSpec[] = [
  { name: 'cleanedBy', kind: 'string' },
  { name: 'cleanedAt', kind: 'timestamp' },
  { name: 'method', kind: 'string' },
  { name: 'notes', kind: 'string' },
  { name: 'status', kind: 'string' },
];

/**
 * Fields whose change invalidates an existing verification.
 *
 * Editing what was cleaned, when, or by whom means the earlier sign-off no
 * longer describes the data it approved. Editing `notes` does not.
 */
export const SUBSTANTIVE_FIELDS: readonly string[] = ['cleanedBy', 'cleanedAt', 'method'];
