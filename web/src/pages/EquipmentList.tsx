import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { Equipment, EquipmentStatus } from '../api/types';

interface Props {
  onSelect: (equipment: Equipment) => void;
}

export function EquipmentList({ onSelect }: Props): JSX.Element {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [status, setStatus] = useState<EquipmentStatus | ''>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null, filter: EquipmentStatus | '') => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.listEquipment({
          ...(filter === '' ? {} : { status: filter }),
          cursor: from,
          limit: 20,
        });
        setEquipment((existing) => (from === null ? page.data : [...existing, ...page.data]));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Could not load equipment');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(null, status);
  }, [load, status]);

  return (
    <section>
      <div className="toolbar">
        <h2>Equipment</h2>
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as EquipmentStatus | '')}
          >
            <option value="">all</option>
            <option value="active">active</option>
            <option value="retired">retired</option>
          </select>
        </label>
      </div>

      {error !== null && <p className="error">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th scope="col">Asset tag</th>
            <th scope="col">Name</th>
            <th scope="col">Status</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {equipment.map((item) => (
            <tr key={item.id}>
              <td>
                <code>{item.code}</code>
              </td>
              <td>{item.name}</td>
              <td>
                <span className={`badge badge-${item.status}`}>{item.status}</span>
              </td>
              <td>
                <button type="button" className="link" onClick={() => onSelect(item)}>
                  Cleaning log
                </button>
              </td>
            </tr>
          ))}
          {equipment.length === 0 && !loading && (
            <tr>
              <td colSpan={4} className="muted">
                No equipment matches this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {hasMore && (
        <button type="button" onClick={() => void load(cursor, status)} disabled={loading}>
          {loading ? 'Loading…' : 'Load more equipment'}
        </button>
      )}
    </section>
  );
}
