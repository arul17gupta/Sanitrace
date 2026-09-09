import { query } from '../db.js';
import type { CleaningMethod } from '../types.js';

interface MethodRow {
  id: string;
  code: string;
  name: string;
  type: CleaningMethod['type'];
  version: number;
  is_active: boolean;
}

const toMethod = (row: MethodRow): CleaningMethod => ({
  id: row.id,
  code: row.code,
  name: row.name,
  type: row.type,
  version: row.version,
  isActive: row.is_active,
});

/**
 * Superseded procedures are never deleted -- historical records still point at
 * them -- so listing for a form must filter to the active ones.
 */
export async function listMethods(activeOnly = true): Promise<CleaningMethod[]> {
  const rows = await query<MethodRow>(
    `select id, code, name, type, version, is_active
     from cleaning_methods
     where ($1::boolean is false or is_active)
     order by code asc`,
    [activeOnly],
  );
  return rows.map(toMethod);
}

export async function findMethod(id: string): Promise<CleaningMethod | null> {
  const rows = await query<MethodRow>(
    `select id, code, name, type, version, is_active from cleaning_methods where id = $1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toMethod(row);
}
