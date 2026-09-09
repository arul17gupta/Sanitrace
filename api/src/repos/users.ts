import { query } from '../db.js';
import type { User, UserRole } from '../types.js';

interface UserRow {
  id: string;
  name: string;
  role: UserRole;
}

const toUser = (row: UserRow): User => ({ id: row.id, name: row.name, role: row.role });

export async function listUsers(): Promise<User[]> {
  const rows = await query<UserRow>(
    `select id, name, role from users order by role desc, name asc`,
  );
  return rows.map(toUser);
}

export async function findUser(id: string): Promise<User | null> {
  const rows = await query<UserRow>(`select id, name, role from users where id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : toUser(row);
}
