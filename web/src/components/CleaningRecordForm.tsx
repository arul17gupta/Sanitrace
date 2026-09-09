import { useMemo, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { CleaningMethod, CleaningRecord, CleaningStatus, User } from '../api/types';
import { isoToLocalInput, localInputToIso } from '../format';

interface Props {
  equipmentId: string;
  users: User[];
  methods: CleaningMethod[];
  /** Absent for a new record. */
  record?: CleaningRecord | undefined;
  onSaved: (record: CleaningRecord) => void;
  onCancel: () => void;
}

/** Fields whose change withdraws an existing verification (mirrors the API). */
const SUBSTANTIVE = ['cleanedBy', 'cleanedAt', 'methodId'] as const;

export function CleaningRecordForm({
  equipmentId,
  users,
  methods,
  record,
  onSaved,
  onCancel,
}: Props): JSX.Element {
  const isEdit = record !== undefined;

  const [cleanedBy, setCleanedBy] = useState(record?.cleanedBy ?? users[0]?.id ?? '');
  const [cleanedAt, setCleanedAt] = useState(
    isoToLocalInput(record?.cleanedAt ?? new Date().toISOString()),
  );
  const [methodId, setMethodId] = useState(record?.methodId ?? methods[0]?.id ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [status, setStatus] = useState<CleaningStatus>(record?.status ?? 'pending');
  const [reason, setReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  /**
   * Only the fields that actually changed are sent.
   *
   * This is what makes a one-field edit produce a one-entry audit trail: the
   * API ignores keys it was not given, so sending the whole form back would
   * still be correct but would tell the reader less.
   */
  const patch = useMemo(() => {
    if (record === undefined) return {};
    const changed: Record<string, unknown> = {};
    if (cleanedBy !== record.cleanedBy) changed.cleanedBy = cleanedBy;
    if (localInputToIso(cleanedAt) !== record.cleanedAt) {
      changed.cleanedAt = localInputToIso(cleanedAt);
    }
    if (methodId !== record.methodId) changed.methodId = methodId;
    const nextNotes = notes.trim() === '' ? null : notes.trim();
    if (nextNotes !== record.notes) changed.notes = nextNotes;
    if (status !== record.status) changed.status = status;
    return changed;
  }, [record, cleanedBy, cleanedAt, methodId, notes, status]);

  const willWithdrawVerification =
    isEdit &&
    record.status === 'verified' &&
    status !== 'pending' &&
    SUBSTANTIVE.some((field) => field in patch);

  const reasonRequired = isEdit && record.status === 'verified' && status === 'pending';

  const apiError = error instanceof ApiError ? error : null;

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (record === undefined) {
        const created = await api.createRecord(equipmentId, {
          cleanedBy,
          cleanedAt: localInputToIso(cleanedAt),
          methodId,
          notes: notes.trim() === '' ? null : notes.trim(),
        });
        onSaved(created);
        return;
      }

      if (Object.keys(patch).length === 0) {
        onCancel();
        return;
      }

      const updated = await api.updateRecord(record.id, {
        ...patch,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      onSaved(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Save failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card form" onSubmit={(event) => void handleSubmit(event)}>
      <h3>{isEdit ? 'Amend cleaning record' : 'Log a cleaning'}</h3>

      <label>
        <span>Cleaned by</span>
        <select value={cleanedBy} onChange={(event) => setCleanedBy(event.target.value)} required>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} ({user.role})
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Cleaned at</span>
        <input
          type="datetime-local"
          value={cleanedAt}
          max={isoToLocalInput(new Date().toISOString())}
          onChange={(event) => setCleanedAt(event.target.value)}
          required
        />
        {apiError?.fieldError('cleanedAt') !== undefined && (
          <em className="field-error">{apiError.fieldError('cleanedAt')}</em>
        )}
      </label>

      <label>
        <span>Method</span>
        <select value={methodId} onChange={(event) => setMethodId(event.target.value)} required>
          {methods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.code} — {method.name} (v{method.version})
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Notes</span>
        <textarea
          value={notes}
          maxLength={1000}
          rows={3}
          placeholder="Visual inspection passed, no visible residue."
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>

      {isEdit && (
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as CleaningStatus)}
          >
            <option value="pending">pending</option>
            <option value="verified">verified</option>
          </select>
        </label>
      )}

      {willWithdrawVerification && (
        <p className="warning">
          This record is verified. Amending what was cleaned, when, or by whom withdraws the
          sign-off and returns the record to <strong>pending</strong>.
        </p>
      )}

      {(reasonRequired || apiError?.code === 'REASON_REQUIRED') && (
        <label>
          <span>Reason for change</span>
          <input
            type="text"
            value={reason}
            maxLength={500}
            placeholder="Swab result came back out of specification."
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </label>
      )}

      {error !== null && (
        <p className="error">
          {apiError?.code === 'SELF_VERIFICATION_FORBIDDEN'
            ? 'A cleaning cannot be verified by the person who performed it. Switch to another user to verify.'
            : error.message}
        </p>
      )}

      <div className="actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save amendment' : 'Log cleaning'}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
