import type { User } from '../api/types';

interface Props {
  users: User[];
  currentUserId: string | null;
  onChange: (id: string) => void;
}

/**
 * Chooses the acting user, which is sent as X-User-Id on every request.
 *
 * This stands in for authentication. It is also how the four-eyes rule is
 * exercised: switch from the operator who logged a cleaning to someone else in
 * order to verify it.
 */
export function UserPicker({ users, currentUserId, onChange }: Props): JSX.Element {
  return (
    <label className="user-picker">
      <span>Acting as</span>
      <select value={currentUserId ?? ''} onChange={(event) => onChange(event.target.value)}>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} — {user.role}
          </option>
        ))}
      </select>
    </label>
  );
}
