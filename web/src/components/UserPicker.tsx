import type { User } from '@/api/types';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  users: User[];
  currentUserId: string | null;
  onChange: (id: string) => void;
}

const userLabel = (user: User): string => `${user.name} — ${user.role}`;

/**
 * Chooses the acting user, which is sent as X-User-Id on every request.
 *
 * This stands in for authentication. It is also how the four-eyes rule is
 * exercised: switch from the operator who logged a cleaning to someone else in
 * order to verify it.
 */
export function UserPicker({ users, currentUserId, onChange }: Props): JSX.Element {
  // Base UI renders the raw value in the trigger unless it is given a
  // value -> label map, so a uuid-valued select needs `items` to show a name.
  const items = Object.fromEntries(users.map((user) => [user.id, userLabel(user)]));

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="acting-as" className="text-xs text-muted-foreground">
        Acting as
      </Label>
      <Select
        items={items}
        value={currentUserId ?? ''}
        onValueChange={(value) => {
          if (typeof value === 'string' && value !== '') onChange(value);
        }}
      >
        <SelectTrigger id="acting-as" className="w-60">
          <SelectValue placeholder="Select a user" />
        </SelectTrigger>
        <SelectContent>
          {users.map((user) => (
            <SelectItem key={user.id} value={user.id}>
              {userLabel(user)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
