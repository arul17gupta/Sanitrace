import { describe, expect, it } from 'vitest';
import type { CleaningRecord } from '@/api/types';
import { isoToLocalInput } from '@/format';
import { buildRecordPatch, isSubstantive, type RecordFormShape } from './patch';

/**
 * What this function omits is what will not appear in the audit trail, so
 * these tests are claims about the trail as much as about the function.
 */

const RECORD: CleaningRecord = {
  id: 'rec-1',
  equipmentId: 'eq-1',
  cleanedBy: 'user-priya',
  cleanedByName: 'Priya Sharma',
  cleanedAt: '2026-09-01T10:00:00.000Z',
  methodId: 'method-14',
  methodCode: 'SOP-CLN-014',
  methodName: 'Manual wash',
  notes: 'Visual inspection passed.',
  status: 'pending',
  createdAt: '2026-09-01T10:25:00.000Z',
  updatedAt: '2026-09-01T10:25:00.000Z',
  verifiedBy: null,
  verifiedByName: null,
  verifiedAt: null,
};

/** The form as it looks when opened on RECORD, with nothing touched. */
const untouched: RecordFormShape = {
  cleanedBy: RECORD.cleanedBy,
  cleanedAt: isoToLocalInput(RECORD.cleanedAt),
  methodId: RECORD.methodId,
  notes: RECORD.notes ?? '',
  status: RECORD.status,
};

describe('buildRecordPatch', () => {
  it('sends nothing when nothing was touched', () => {
    expect(buildRecordPatch(RECORD, untouched)).toEqual({});
  });

  it('sends only the field that changed', () => {
    expect(buildRecordPatch(RECORD, { ...untouched, notes: 'Second rinse required.' })).toEqual({
      notes: 'Second rinse required.',
    });
  });

  it('ignores whitespace-only edits to the notes', () => {
    expect(
      buildRecordPatch(RECORD, { ...untouched, notes: '  Visual inspection passed.  ' }),
    ).toEqual({});
  });

  it('sends null when the notes are cleared', () => {
    // An empty textarea means "no note", not an empty string -- otherwise the
    // audit trail would record '' as the new value.
    expect(buildRecordPatch(RECORD, { ...untouched, notes: '   ' })).toEqual({ notes: null });
  });

  it('does not resend an unchanged timestamp that merely round-tripped', () => {
    // The form holds local wall-clock time and the record holds ISO. If the two
    // were compared as strings this would look like a change on every save.
    const roundTripped = isoToLocalInput(RECORD.cleanedAt);
    expect(buildRecordPatch(RECORD, { ...untouched, cleanedAt: roundTripped })).toEqual({});
  });

  it('sends a genuinely changed timestamp as ISO', () => {
    const patch = buildRecordPatch(RECORD, {
      ...untouched,
      cleanedAt: isoToLocalInput('2026-09-01T11:00:00.000Z'),
    });
    expect(patch.cleanedAt).toBe('2026-09-01T11:00:00.000Z');
    expect(Object.keys(patch)).toEqual(['cleanedAt']);
  });

  it('sends several fields when several changed', () => {
    const patch = buildRecordPatch(RECORD, {
      ...untouched,
      methodId: 'method-21',
      status: 'verified',
    });
    expect(patch).toEqual({ methodId: 'method-21', status: 'verified' });
  });

  it('treats a record with no note and an empty textarea as unchanged', () => {
    const noNotes = { ...RECORD, notes: null };
    expect(buildRecordPatch(noNotes, { ...untouched, notes: '' })).toEqual({});
  });
});

describe('isSubstantive', () => {
  it('is true for a change to what was cleaned, when, or by whom', () => {
    expect(isSubstantive({ methodId: 'method-21' })).toBe(true);
    expect(isSubstantive({ cleanedAt: '2026-09-01T11:00:00.000Z' })).toBe(true);
    expect(isSubstantive({ cleanedBy: 'user-arun' })).toBe(true);
  });

  it('is false for notes or status alone', () => {
    // Editing only the notes must not withdraw a sign-off.
    expect(isSubstantive({ notes: 'Typo fixed.' })).toBe(false);
    expect(isSubstantive({ status: 'verified' })).toBe(false);
    expect(isSubstantive({})).toBe(false);
  });
});
