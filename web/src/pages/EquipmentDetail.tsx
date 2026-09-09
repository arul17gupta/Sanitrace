import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import type {
  CleaningMethod,
  CleaningRecord,
  CleaningStatus,
  Equipment,
  User,
} from '../api/types';
import { AuditTrail } from '../components/AuditTrail';
import { CleaningRecordForm } from '../components/CleaningRecordForm';
import { formatTimestamp, orDash } from '../format';

interface Props {
  equipment: Equipment;
  users: User[];
  methods: CleaningMethod[];
  onBack: () => void;
}

type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; record: CleaningRecord };

export function EquipmentDetail({ equipment, users, methods, onBack }: Props): JSX.Element {
  const [records, setRecords] = useState<CleaningRecord[]>([]);
  const [status, setStatus] = useState<CleaningStatus | ''>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [auditFor, setAuditFor] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null, filter: CleaningStatus | '') => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.listRecords(equipment.id, {
          ...(filter === '' ? {} : { status: filter }),
          cursor: from,
          limit: 10,
        });
        setRecords((existing) => (from === null ? page.data : [...existing, ...page.data]));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Could not load cleaning records');
      } finally {
        setLoading(false);
      }
    },
    [equipment.id],
  );

  useEffect(() => {
    void load(null, status);
  }, [load, status]);

  const handleSaved = (): void => {
    setForm({ mode: 'closed' });
    // Re-read from the first page: an amendment can change the record's status
    // and its position is fixed by cleanedAt, so a local patch would be a guess.
    void load(null, status);
  };

  return (
    <section>
      <button type="button" className="link" onClick={onBack}>
        &larr; All equipment
      </button>

      <div className="toolbar">
        <h2>
          <code>{equipment.code}</code> {equipment.name}
        </h2>
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as CleaningStatus | '')}
          >
            <option value="">all</option>
            <option value="pending">pending</option>
            <option value="verified">verified</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setForm({ mode: 'create' })}
          disabled={equipment.status === 'retired'}
          title={
            equipment.status === 'retired'
              ? 'Retired equipment is out of service'
              : 'Log a cleaning'
          }
        >
          Log a cleaning
        </button>
      </div>

      {form.mode === 'create' && (
        <CleaningRecordForm
          equipmentId={equipment.id}
          users={users}
          methods={methods}
          onSaved={handleSaved}
          onCancel={() => setForm({ mode: 'closed' })}
        />
      )}

      {form.mode === 'edit' && (
        <CleaningRecordForm
          equipmentId={equipment.id}
          users={users}
          methods={methods}
          record={form.record}
          onSaved={handleSaved}
          onCancel={() => setForm({ mode: 'closed' })}
        />
      )}

      {error !== null && <p className="error">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th scope="col">Cleaned at</th>
            <th scope="col">Cleaned by</th>
            <th scope="col">Method</th>
            <th scope="col">Notes</th>
            <th scope="col">Status</th>
            <th scope="col">Verified by</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{formatTimestamp(record.cleanedAt)}</td>
              <td>{record.cleanedByName}</td>
              <td>
                <code>{record.methodCode}</code>
              </td>
              <td className="notes">{orDash(record.notes)}</td>
              <td>
                <span className={`badge badge-${record.status}`}>{record.status}</span>
              </td>
              <td>{orDash(record.verifiedByName)}</td>
              <td className="row-actions">
                <button
                  type="button"
                  className="link"
                  onClick={() => setForm({ mode: 'edit', record })}
                >
                  Amend
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => setAuditFor(auditFor === record.id ? null : record.id)}
                >
                  {auditFor === record.id ? 'Hide history' : 'History'}
                </button>
              </td>
            </tr>
          ))}
          {records.length === 0 && !loading && (
            <tr>
              <td colSpan={7} className="muted">
                No cleaning records for this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {hasMore && (
        <button type="button" onClick={() => void load(cursor, status)} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}

      {auditFor !== null && <AuditTrail recordId={auditFor} />}
    </section>
  );
}
