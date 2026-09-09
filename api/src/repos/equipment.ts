import { query } from '../db.js';
import { buildPage, type Cursor } from '../pagination.js';
import type { Equipment, EquipmentStatus, Page } from '../types.js';

interface EquipmentRow {
  id: string;
  name: string;
  code: string;
  status: EquipmentStatus;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS = `id, name, code, status, created_at, updated_at`;

const toEquipment = (row: EquipmentRow): Equipment => ({
  id: row.id,
  name: row.name,
  code: row.code,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface ListEquipmentOptions {
  status?: EquipmentStatus | undefined;
  limit: number;
  cursor?: Cursor | undefined;
}

/**
 * Equipment is ordered by asset tag, which is how someone standing in front of
 * a machine looks it up.
 *
 * `code` is unique, so it is already a total ordering and the cursor needs no
 * tie-breaker -- unlike cleaning records, which are ordered by a timestamp that
 * can repeat. The nullable predicates keep filter and cursor optional without
 * concatenating SQL.
 */
export async function listEquipment(options: ListEquipmentOptions): Promise<Page<Equipment>> {
  const rows = await query<EquipmentRow>(
    `select ${SELECT_COLUMNS}
     from equipment
     where ($1::equipment_status is null or status = $1)
       and ($2::varchar is null or code > $2)
     order by code asc
     limit $3`,
    [options.status ?? null, options.cursor?.sortValue ?? null, options.limit + 1],
  );

  return buildPage(rows.map(toEquipment), options.limit, (item) => ({
    sortValue: item.code,
    id: item.id,
  }));
}

export async function findEquipment(id: string): Promise<Equipment | null> {
  const rows = await query<EquipmentRow>(
    `select ${SELECT_COLUMNS} from equipment where id = $1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toEquipment(row);
}

export async function createEquipment(input: {
  name: string;
  code: string;
  status?: EquipmentStatus;
}): Promise<Equipment> {
  const rows = await query<EquipmentRow>(
    `insert into equipment (name, code, status)
     values ($1, $2, coalesce($3::equipment_status, 'active'))
     returning ${SELECT_COLUMNS}`,
    [input.name, input.code, input.status ?? null],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Insert returned no row');
  return toEquipment(row);
}

/**
 * `coalesce` gives partial updates for free here because all three columns are
 * NOT NULL -- a `null` parameter can only mean "not supplied". A nullable
 * column would need an explicit presence flag (see `updateCleaningRecord`).
 */
export async function updateEquipment(
  id: string,
  patch: { name?: string; code?: string; status?: EquipmentStatus },
): Promise<Equipment | null> {
  const rows = await query<EquipmentRow>(
    `update equipment
        set name       = coalesce($2::varchar, name),
            code       = coalesce($3::varchar, code),
            status     = coalesce($4::equipment_status, status),
            updated_at = now()
      where id = $1
      returning ${SELECT_COLUMNS}`,
    [id, patch.name ?? null, patch.code ?? null, patch.status ?? null],
  );
  const row = rows[0];
  return row === undefined ? null : toEquipment(row);
}

/**
 * Retire rather than delete. Equipment that has been cleaned carries history
 * that must survive for the regulatory retention period, so there is no path in
 * this API that removes the row.
 */
export async function retireEquipment(id: string): Promise<Equipment | null> {
  return updateEquipment(id, { status: 'retired' });
}
