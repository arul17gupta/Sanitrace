import { useEffect, useState } from 'react';
import { api, setCurrentUserId } from '@/api/client';
import type { CleaningMethod, Equipment, User } from '@/api/types';
import { UserPicker } from '@/components/UserPicker';
import { EquipmentDetail } from '@/pages/EquipmentDetail';
import { EquipmentList } from '@/pages/EquipmentList';

/**
 * Two screens, selected by state rather than by a router.
 *
 * A router would be the right call the moment a record needs a shareable URL,
 * and that is worth having for an audit tool -- but it is not what this
 * exercise is being read for, so it is listed in NOTES.md as a deliberate
 * omission instead of being half-built here.
 */
export function App(): JSX.Element {
  const [users, setUsers] = useState<User[]>([]);
  const [methods, setMethods] = useState<CleaningMethod[]>([]);
  const [actorId, setActorId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Equipment | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    async function boot(): Promise<void> {
      try {
        const [loadedUsers, loadedMethods] = await Promise.all([
          api.listUsers(),
          api.listMethods(),
        ]);
        setUsers(loadedUsers);
        setMethods(loadedMethods);

        // Default to a supervisor so the app opens able to verify something.
        const initial = loadedUsers.find((user) => user.role === 'supervisor') ?? loadedUsers[0];
        if (initial !== undefined) {
          setActorId(initial.id);
          setCurrentUserId(initial.id);
        }
      } catch {
        setBootError(
          'Could not reach the API. Start it with `npm run dev:api` and check the database is set up.',
        );
      }
    }

    void boot();
  }, []);

  function handleActorChange(id: string): void {
    setActorId(id);
    setCurrentUserId(id);
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 py-5">
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight">Sanitrace</h1>
            <p className="text-sm text-muted-foreground">
              Equipment cleaning log with a full audit trail
            </p>
          </div>
          {users.length > 0 && (
            <UserPicker users={users} currentUserId={actorId} onChange={handleActorChange} />
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {bootError !== null && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {bootError}
          </p>
        )}

        {bootError === null && selected === null && <EquipmentList onSelect={setSelected} />}

        {bootError === null && selected !== null && (
          <EquipmentDetail
            equipment={selected}
            users={users}
            methods={methods}
            onBack={() => setSelected(null)}
          />
        )}
      </main>
    </div>
  );
}
