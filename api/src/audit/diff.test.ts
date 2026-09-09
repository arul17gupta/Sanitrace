import { describe, expect, it } from 'vitest';
import { CLEANING_RECORD_FIELDS, diffRecord, type FieldSpec } from './diff.js';

/**
 * The audit diff is the part of this system a regulator would actually read, so
 * these tests are written as claims about the trail rather than as coverage of
 * the function.
 */

const FIELDS = CLEANING_RECORD_FIELDS;

const before = {
  cleanedBy: 'Priya Sharma',
  cleanedAt: '2026-09-01T10:00:00.000Z',
  method: 'SOP-CLN-014',
  notes: 'Visual inspection passed.',
  status: 'pending',
};

describe('diffRecord on create', () => {
  it('records every populated field with no old value', () => {
    const changes = diffRecord(null, before, FIELDS);

    expect(changes).toEqual([
      { field: 'cleanedBy', oldValue: null, newValue: 'Priya Sharma' },
      { field: 'cleanedAt', oldValue: null, newValue: '2026-09-01T10:00:00.000Z' },
      { field: 'method', oldValue: null, newValue: 'SOP-CLN-014' },
      { field: 'notes', oldValue: null, newValue: 'Visual inspection passed.' },
      { field: 'status', oldValue: null, newValue: 'pending' },
    ]);
  });

  it('omits fields that hold no value, rather than recording null to null', () => {
    const changes = diffRecord(null, { ...before, notes: null }, FIELDS);

    expect(changes.map((c) => c.field)).not.toContain('notes');
    expect(changes).toHaveLength(4);
  });
});

describe('diffRecord on update', () => {
  it('records nothing when no value changed', () => {
    expect(diffRecord(before, { ...before }, FIELDS)).toEqual([]);
  });

  it('records exactly one entry for a single-field change', () => {
    const changes = diffRecord(before, { notes: 'Re-cleaned; second rinse required.' }, FIELDS);

    expect(changes).toEqual([
      {
        field: 'notes',
        oldValue: 'Visual inspection passed.',
        newValue: 'Re-cleaned; second rinse required.',
      },
    ]);
  });

  it('ignores fields the request did not carry', () => {
    // A PATCH of one field must not claim the untouched fields were "changed"
    // to their current values.
    const changes = diffRecord(before, { status: 'verified' }, FIELDS);

    expect(changes).toEqual([{ field: 'status', oldValue: 'pending', newValue: 'verified' }]);
  });

  it('treats a re-spelled timestamp as no change', () => {
    // The same instant, written three ways. A phantom entry here would tell an
    // inspector that the cleaning time was amended when it was not.
    for (const equivalent of [
      '2026-09-01T10:00:00Z',
      '2026-09-01T10:00:00.000+00:00',
      '2026-09-01T15:30:00.000+05:30',
    ]) {
      expect(diffRecord(before, { cleanedAt: equivalent }, FIELDS)).toEqual([]);
    }
  });

  it('records a genuine timestamp change', () => {
    const changes = diffRecord(before, { cleanedAt: '2026-09-01T11:00:00.000Z' }, FIELDS);

    expect(changes).toEqual([
      {
        field: 'cleanedAt',
        oldValue: '2026-09-01T10:00:00.000Z',
        newValue: '2026-09-01T11:00:00.000Z',
      },
    ]);
  });

  it('records a cleared field as old value to null', () => {
    const changes = diffRecord(before, { notes: null }, FIELDS);

    expect(changes).toEqual([
      { field: 'notes', oldValue: 'Visual inspection passed.', newValue: null },
    ]);
  });

  it('treats an empty string as clearing the field, not as a value', () => {
    const changes = diffRecord(before, { notes: '   ' }, FIELDS);

    expect(changes).toEqual([
      { field: 'notes', oldValue: 'Visual inspection passed.', newValue: null },
    ]);
  });

  it('does not record whitespace-only differences', () => {
    expect(diffRecord(before, { notes: '  Visual inspection passed.  ' }, FIELDS)).toEqual([]);
  });

  it('records multiple changed fields in the order of the allow-list', () => {
    const changes = diffRecord(
      before,
      { status: 'verified', method: 'SOP-CLN-021' },
      FIELDS,
    );

    expect(changes.map((c) => c.field)).toEqual(['method', 'status']);
  });
});

describe('diffRecord field allow-list', () => {
  it('never records a field outside the allow-list', () => {
    // Bookkeeping columns must not leak into the trail even if a caller passes
    // them, which is why the allow-list is an argument and not Object.keys.
    const changes = diffRecord(
      before,
      { notes: 'Amended.', updatedAt: '2026-09-02T00:00:00.000Z', id: 'abc' },
      FIELDS,
    );

    expect(changes.map((c) => c.field)).toEqual(['notes']);
  });

  it('only walks the fields it is given', () => {
    const notesOnly: readonly FieldSpec[] = [{ name: 'notes', kind: 'string' }];

    const changes = diffRecord(before, { notes: 'Amended.', status: 'verified' }, notesOnly);

    expect(changes.map((c) => c.field)).toEqual(['notes']);
  });
});
