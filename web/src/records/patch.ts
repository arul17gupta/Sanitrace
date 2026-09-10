import type { CleaningRecord, CleaningStatus } from '@/api/types';
import { localInputToIso } from '@/format';

/**
 * Works out what a form submission actually changed.
 *
 * This is the client-side counterpart to the API's audit diff, and it carries
 * real weight: the API only audits the fields it is given, so whatever this
 * function omits is what will *not* appear in the audit trail. Sending the
 * whole form back would still be correct, but every edit would then read as a
 * change to all five fields.
 *
 * Extracted from the form component so it can be tested without rendering
 * anything -- the same reason `audit/diff.ts` is pure on the server.
 */

/** The form's values, as the inputs hold them (cleanedAt is datetime-local). */
export interface RecordFormShape {
  cleanedBy: string;
  cleanedAt: string;
  methodId: string;
  notes: string;
  status: CleaningStatus;
}

export interface RecordPatch {
  cleanedBy?: string;
  cleanedAt?: string;
  methodId?: string;
  /** `null` clears the note; absent leaves it alone. */
  notes?: string | null;
  status?: CleaningStatus;
}

/**
 * Fields whose change withdraws an existing verification.
 *
 * Mirrors `SUBSTANTIVE_FIELDS` in the API's audit/diff.ts, in the client's
 * naming (`methodId` rather than `method`).
 */
export const SUBSTANTIVE_FIELDS = ['cleanedBy', 'cleanedAt', 'methodId'] as const;

export function buildRecordPatch(
  record: CleaningRecord,
  values: RecordFormShape,
): RecordPatch {
  const patch: RecordPatch = {};

  if (values.cleanedBy !== record.cleanedBy) patch.cleanedBy = values.cleanedBy;

  // Compared as instants, not as strings: the form holds local wall-clock time
  // and the record holds ISO, so the two are only comparable once converted.
  const nextCleanedAt = localInputToIso(values.cleanedAt);
  if (nextCleanedAt !== record.cleanedAt) patch.cleanedAt = nextCleanedAt;

  if (values.methodId !== record.methodId) patch.methodId = values.methodId;

  // A blank textarea means "no note", which is null rather than an empty
  // string -- the same normalisation the server's diff applies.
  const nextNotes = values.notes.trim() === '' ? null : values.notes.trim();
  if (nextNotes !== record.notes) patch.notes = nextNotes;

  if (values.status !== record.status) patch.status = values.status;

  return patch;
}

/** Whether a patch touches a field that invalidates a sign-off. */
export function isSubstantive(patch: RecordPatch): boolean {
  return SUBSTANTIVE_FIELDS.some((field) => field in patch);
}
