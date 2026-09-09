import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, query } from '../db.js';
import type { AuditChangeSet, CleaningMethod, CleaningRecord, Equipment, User } from '../types.js';
import { resetTestDatabase } from './db.js';

/**
 * Integration tests against a real PostgreSQL database.
 *
 * These cover the two things the schema asserts but no unit test can prove: the
 * audit trail is written correctly through the whole stack, and the append-only
 * triggers actually fire.
 */

const app = createApp();

let operator: User;
let otherOperator: User;
let supervisor: User;
let methods: CleaningMethod[];
let equipment: Equipment;

const asUser = (user: User) => ({ 'X-User-Id': user.id });

/** Records are created at a past instant: a future cleanedAt is rejected. */
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

beforeAll(async () => {
  await resetTestDatabase();

  const users = (await request(app).get('/api/users').expect(200)).body.data as User[];
  const operators = users.filter((u) => u.role === 'operator');
  const found = users.find((u) => u.role === 'supervisor');
  if (operators[0] === undefined || operators[1] === undefined || found === undefined) {
    throw new Error('seed must provide two operators and a supervisor');
  }
  [operator, otherOperator] = [operators[0], operators[1]];
  supervisor = found;

  methods = (await request(app).get('/api/cleaning-methods').expect(200)).body
    .data as CleaningMethod[];

  const list = (await request(app).get('/api/equipment?status=active').expect(200)).body
    .data as Equipment[];
  const mt003 = list.find((e) => e.code === 'MT-003');
  if (mt003 === undefined) throw new Error('seed must provide MT-003');
  equipment = mt003;
}, 60_000);

afterAll(async () => {
  await closePool();
});

/**
 * Returns the supertest request rather than awaiting it, so each call site can
 * chain its own `.expect(status)`.
 */
function createRecord(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/equipment/${equipment.id}/cleaning-records`)
    .set(asUser(operator))
    .send({
      cleanedBy: operator.id,
      cleanedAt: minutesAgo(30),
      methodId: methods[0]?.id,
      notes: 'Visual inspection passed.',
      ...overrides,
    });
}

async function auditOf(recordId: string): Promise<AuditChangeSet[]> {
  const response = await request(app)
    .get(`/api/cleaning-records/${recordId}/audit`)
    .expect(200);
  return response.body.data as AuditChangeSet[];
}

describe('audit trail through the stack', () => {
  it('records the origin of a new record with no old values', async () => {
    const created = await createRecord().expect(201);
    const record = created.body as CleaningRecord;

    const history = await auditOf(record.id);
    expect(history).toHaveLength(1);

    const changeSet = history[0] as AuditChangeSet;
    expect(changeSet.action).toBe('create');
    expect(changeSet.changedByName).toBe(operator.name);
    expect(changeSet.entries.every((entry) => entry.oldValue === null)).toBe(true);
    expect(changeSet.entries.map((entry) => entry.field).sort()).toEqual([
      'cleanedAt',
      'cleanedBy',
      'method',
      'notes',
      'status',
    ]);
    // Stored human-readable: an inspector must not have to resolve a uuid.
    expect(changeSet.entries.find((entry) => entry.field === 'method')?.newValue).toBe(
      methods[0]?.code,
    );
    expect(changeSet.entries.find((entry) => entry.field === 'cleanedBy')?.newValue).toBe(
      operator.name,
    );
  });

  it('records exactly one entry when one field is amended', async () => {
    const record = (await createRecord().expect(201)).body as CleaningRecord;

    await request(app)
      .patch(`/api/cleaning-records/${record.id}`)
      .set(asUser(supervisor))
      .send({ notes: 'Second rinse required.' })
      .expect(200);

    const history = await auditOf(record.id);
    expect(history).toHaveLength(2);

    const latest = history[0] as AuditChangeSet;
    expect(latest.action).toBe('update');
    expect(latest.changedByName).toBe(supervisor.name);
    expect(latest.entries).toHaveLength(1);
    expect(latest.entries[0]).toMatchObject({
      field: 'notes',
      oldValue: 'Visual inspection passed.',
      newValue: 'Second rinse required.',
    });
  });

  it('writes nothing at all for an edit that changes no value', async () => {
    const record = (await createRecord().expect(201)).body as CleaningRecord;
    const before = await auditOf(record.id);

    await request(app)
      .patch(`/api/cleaning-records/${record.id}`)
      .set(asUser(supervisor))
      .send({ notes: 'Visual inspection passed.', status: 'pending' })
      .expect(200);

    expect(await auditOf(record.id)).toHaveLength(before.length);
  });

  it('records a cleared field as a change to null', async () => {
    const record = (await createRecord().expect(201)).body as CleaningRecord;

    const patched = await request(app)
      .patch(`/api/cleaning-records/${record.id}`)
      .set(asUser(supervisor))
      .send({ notes: null })
      .expect(200);

    expect((patched.body as CleaningRecord).notes).toBeNull();

    const latest = (await auditOf(record.id))[0] as AuditChangeSet;
    expect(latest.entries[0]).toMatchObject({
      field: 'notes',
      oldValue: 'Visual inspection passed.',
      newValue: null,
    });
  });
});

describe('four-eyes rule', () => {
  it('refuses verification by the person who performed the cleaning', async () => {
    const record = (await createRecord().expect(201)).body as CleaningRecord;

    const response = await request(app)
      .patch(`/api/cleaning-records/${record.id}`)
      .set(asUser(operator))
      .send({ status: 'verified' })
      .expect(409);

    expect(response.body.error.code).toBe('SELF_VERIFICATION_FORBIDDEN');
    expect(await auditOf(record.id)).toHaveLength(1); // nothing was written
  });

  it('accepts verification by someone else and derives the verifier from the trail', async () => {
    const record = (await createRecord().expect(201)).body as CleaningRecord;

    const verified = (
      await request(app)
        .patch(`/api/cleaning-records/${record.id}`)
        .set(asUser(supervisor))
        .send({ status: 'verified' })
        .expect(200)
    ).body as CleaningRecord;

    expect(verified.status).toBe('verified');
    // Not a stored column: read back out of the change set that did it.
    expect(verified.verifiedBy).toBe(supervisor.id);
    expect(verified.verifiedByName).toBe(supervisor.name);
    expect(verified.verifiedAt).not.toBeNull();
  });
});

describe('re-verification after amendment', () => {
  it('withdraws the sign-off when a substantive field changes, and says why', async () => {
    const record = (await createRecord().expect(201)).body as CleaningRecord;

    await request(app)
      .patch(`/api/cleaning-records/${record.id}`)
      .set(asUser(supervisor))
      .send({ status: 'verified' })
      .expect(200);

    const amended = (
      await request(app)
        .patch(`/api/cleaning-records/${record.id}`)
        .set(asUser(supervisor))
        .send({ methodId: methods[1]?.id })
        .expect(200)
    ).body as CleaningRecord;

    expect(amended.status).toBe('pending');
    expect(amended.verifiedBy).toBeNull(); // the stale sign-off is not reported

    const latest = (await auditOf(record.id))[0] as AuditChangeSet;
    expect(latest.reason).toMatch(/withdrawn automatically/i);
    expect(latest.entries.map((entry) => entry.field).sort()).toEqual(['method', 'status']);
    expect(latest.entries.find((entry) => entry.field === 'status')).toMatchObject({
      oldValue: 'verified',
      newValue: 'pending',
    });
  });

  it('keeps the sign-off when only the notes change', async () => {
    const record = (await createRecord().expect(201)).body as CleaningRecord;

    await request(app)
      .patch(`/api/cleaning-records/${record.id}`)
      .set(asUser(supervisor))
      .send({ status: 'verified' })
      .expect(200);

    const amended = (
      await request(app)
        .patch(`/api/cleaning-records/${record.id}`)
        .set(asUser(supervisor))
        .send({ notes: 'Typo corrected in observation.' })
        .expect(200)
    ).body as CleaningRecord;

    expect(amended.status).toBe('verified');
  });

  it('requires a reason to withdraw a verification by hand', async () => {
    const record = (await createRecord().expect(201)).body as CleaningRecord;

    await request(app)
      .patch(`/api/cleaning-records/${record.id}`)
      .set(asUser(supervisor))
      .send({ status: 'verified' })
      .expect(200);

    const rejected = await request(app)
      .patch(`/api/cleaning-records/${record.id}`)
      .set(asUser(supervisor))
      .send({ status: 'pending' })
      .expect(400);

    expect(rejected.body.error.code).toBe('REASON_REQUIRED');

    await request(app)
      .patch(`/api/cleaning-records/${record.id}`)
      .set(asUser(supervisor))
      .send({ status: 'pending', reason: 'Swab result out of specification.' })
      .expect(200);

    const latest = (await auditOf(record.id))[0] as AuditChangeSet;
    expect(latest.reason).toBe('Swab result out of specification.');
  });
});

describe('validation and attribution', () => {
  it('refuses a write with no identified user', async () => {
    const response = await request(app)
      .post(`/api/equipment/${equipment.id}/cleaning-records`)
      .send({ cleanedBy: operator.id, cleanedAt: minutesAgo(5), methodId: methods[0]?.id })
      .expect(401);

    expect(response.body.error.code).toBe('USER_REQUIRED');
  });

  it('refuses a cleaning recorded in the future', async () => {
    const response = await createRecord({
      cleanedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    }).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.cleanedAt?.[0]).toMatch(/future/i);
  });

  it('refuses a superseded cleaning method', async () => {
    const all = (
      await request(app).get('/api/cleaning-methods?includeInactive=true').expect(200)
    ).body.data as CleaningMethod[];
    const superseded = all.find((m) => !m.isActive);

    const response = await createRecord({ methodId: superseded?.id }).expect(409);
    expect(response.body.error.code).toBe('METHOD_INACTIVE');
  });

  it('refuses logging against retired equipment', async () => {
    const list = (await request(app).get('/api/equipment?status=retired').expect(200)).body
      .data as Equipment[];
    const retired = list[0] as Equipment;

    const response = await request(app)
      .post(`/api/equipment/${retired.id}/cleaning-records`)
      .set(asUser(operator))
      .send({ cleanedBy: operator.id, cleanedAt: minutesAgo(5), methodId: methods[0]?.id })
      .expect(409);

    expect(response.body.error.code).toBe('EQUIPMENT_RETIRED');
  });
});

describe('keyset pagination', () => {
  /**
   * The property that offset pagination does not have.
   *
   * A reader walks the log page by page while a new cleaning is logged. With
   * OFFSET, the insert shifts every later row by one and the reader sees a row
   * twice. With a cursor, the page boundary is a value rather than a position,
   * so the walk stays correct.
   */
  it('yields every row exactly once even when a row is inserted mid-walk', async () => {
    const fresh = (
      await request(app)
        .post('/api/equipment')
        .set(asUser(supervisor))
        .send({ name: 'Pagination Rig', code: 'PAG-001' })
        .expect(201)
    ).body as Equipment;

    const expectedIds: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const created = await request(app)
        .post(`/api/equipment/${fresh.id}/cleaning-records`)
        .set(asUser(operator))
        .send({
          cleanedBy: operator.id,
          cleanedAt: minutesAgo(120 + i * 10),
          methodId: methods[0]?.id,
          notes: `Run ${i}`,
        })
        .expect(201);
      expectedIds.push((created.body as CleaningRecord).id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let interrupted = false;
    let intruderId: string | null = null;

    do {
      const url =
        `/api/equipment/${fresh.id}/cleaning-records?limit=5` +
        (cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`);
      const page = (await request(app).get(url).expect(200)).body as {
        data: CleaningRecord[];
        nextCursor: string | null;
      };

      seen.push(...page.data.map((record) => record.id));
      cursor = page.nextCursor;

      // Insert a newer cleaning after the first page has been read.
      if (!interrupted) {
        interrupted = true;
        const intruder = await request(app)
          .post(`/api/equipment/${fresh.id}/cleaning-records`)
          .set(asUser(otherOperator))
          .send({
            cleanedBy: otherOperator.id,
            cleanedAt: minutesAgo(1),
            methodId: methods[0]?.id,
            notes: 'Logged while the report was being read',
          })
          .expect(201);
        intruderId = (intruder.body as CleaningRecord).id;
      }
    } while (cursor !== null);

    expect(seen).toHaveLength(new Set(seen).size); // no duplicates
    expect(new Set(seen)).toEqual(new Set(expectedIds)); // nothing skipped
    // The new row sorts ahead of the first cursor, so this walk never sees it;
    // it belongs to the next read, not this one.
    expect(seen).not.toContain(intruderId);
  });

  it('filters by status and still pages', async () => {
    const page = (
      await request(app)
        .get(`/api/equipment/${equipment.id}/cleaning-records?status=verified&limit=3`)
        .expect(200)
    ).body as { data: CleaningRecord[]; hasMore: boolean; nextCursor: string | null };

    expect(page.data.length).toBeLessThanOrEqual(3);
    expect(page.data.every((record) => record.status === 'verified')).toBe(true);
    if (page.hasMore) expect(page.nextCursor).not.toBeNull();
  });

  it('rejects a tampered cursor', async () => {
    const response = await request(app)
      .get(`/api/equipment/${equipment.id}/cleaning-records?cursor=zzzz`)
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_CURSOR');
  });
});

describe('the audit trail is append-only', () => {
  /**
   * 21 CFR Part 11 requires that the trail cannot be edited or deleted. These
   * two tests go around the API entirely and hit the database directly,
   * because that is the threat model: the guard has to hold for anything
   * holding a connection, not just for this service.
   */
  it('refuses an UPDATE of an audit entry', async () => {
    await expect(
      query(`update audit_entries set new_value = 'tampered' where id = (select min(id) from audit_entries)`),
    ).rejects.toThrow(/append-only/i);
  });

  it('refuses a DELETE of an audit entry', async () => {
    await expect(
      query(`delete from audit_entries where id = (select min(id) from audit_entries)`),
    ).rejects.toThrow(/append-only/i);
  });

  it('refuses an UPDATE of a change set', async () => {
    await expect(
      query(`update audit_change_sets set reason = 'tampered' where reason is not null`),
    ).rejects.toThrow(/append-only/i);
  });
});
