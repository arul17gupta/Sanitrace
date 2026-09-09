import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { AuditChangeSet } from '../api/types';
import { fieldLabel, formatTimestamp, orDash } from '../format';

interface Props {
  recordId: string;
}

/**
 * The audit history for one record.
 *
 * Grouped by change set rather than by timestamp: the API tells us which field
 * changes belong to the same edit, so the UI does not have to guess from the
 * clock. Each group is one thing a person did, with the reason they gave.
 */
export function AuditTrail({ recordId }: Props): JSX.Element {
  const [changeSets, setChangeSets] = useState<AuditChangeSet[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.listAudit(recordId, { cursor: from, limit: 10 });
        setChangeSets((existing) => (from === null ? page.data : [...existing, ...page.data]));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Could not load the audit trail');
      } finally {
        setLoading(false);
      }
    },
    [recordId],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <section className="audit" aria-label="Audit trail">
      <h3>Audit trail</h3>

      {error !== null && <p className="error">{error}</p>}

      {changeSets.length === 0 && !loading && error === null && (
        <p className="muted">No history for this record.</p>
      )}

      <ol className="audit-list">
        {changeSets.map((changeSet) => (
          <li key={changeSet.id} className="audit-change-set">
            <header>
              <span className={`badge badge-${changeSet.action}`}>{changeSet.action}</span>
              <strong>{changeSet.changedByName}</strong>
              <time dateTime={changeSet.changedAt}>{formatTimestamp(changeSet.changedAt)}</time>
            </header>

            {changeSet.reason !== null && <p className="audit-reason">{changeSet.reason}</p>}

            <table className="audit-fields">
              <tbody>
                {changeSet.entries.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">{fieldLabel(entry.field)}</th>
                    <td className="old">{orDash(entry.oldValue)}</td>
                    <td aria-hidden="true" className="arrow">
                      &rarr;
                    </td>
                    <td className="new">{orDash(entry.newValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </li>
        ))}
      </ol>

      {hasMore && (
        <button type="button" onClick={() => void load(cursor)} disabled={loading}>
          {loading ? 'Loading…' : 'Load older history'}
        </button>
      )}
    </section>
  );
}
