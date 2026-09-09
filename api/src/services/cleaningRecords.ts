import {
  CLEANING_RECORD_FIELDS,
  SUBSTANTIVE_FIELDS,
  diffRecord,
  type AuditableValues,
} from '../audit/diff.js';
import { writeAudit } from '../audit/writer.js';
import { withTransaction } from '../db.js';
import { AppError, conflict, notFound } from '../errors.js';
import { evaluateTransition, FORCED_REVERT_REASON } from '../domain/status.js';
import { findEquipment } from '../repos/equipment.js';
import { findMethod } from '../repos/methods.js';
import { findUser } from '../repos/users.js';
import {
  auditableProjection,
  findRecord,
  insertRecord,
  lockRecord,
  updateRecord,
} from '../repos/cleaningRecords.js';
import type { CleaningRecord, CleaningStatus } from '../types.js';

/**
 * Orchestration for the two writes that produce audit entries.
 *
 * The routes stay thin and the rules stay testable: diffing lives in
 * audit/diff.ts, the status rules in domain/status.ts, and this module only
 * sequences them inside one transaction.
 */

export interface CreateInput {
  equipmentId: string;
  cleanedBy: string;
  cleanedAt: string;
  methodId: string;
  notes?: string | null | undefined;
}

export async function createCleaningRecord(
  input: CreateInput,
  actorId: string,
): Promise<CleaningRecord> {
  const equipment = await findEquipment(input.equipmentId);
  if (equipment === null) throw notFound('Equipment');

  // Retired equipment is out of service, so there is nothing legitimate to log
  // against it. Blocking this is cheaper than explaining the record later.
  if (equipment.status === 'retired') {
    throw conflict('EQUIPMENT_RETIRED', 'Cleaning cannot be logged against retired equipment.');
  }

  const method = await findMethod(input.methodId);
  if (method === null) throw notFound('Cleaning method');
  if (!method.isActive) {
    throw conflict(
      'METHOD_INACTIVE',
      `${method.code} is superseded and cannot be selected for new work.`,
    );
  }

  const cleaner = await findUser(input.cleanedBy);
  if (cleaner === null) throw notFound('User in cleanedBy');

  return withTransaction(async (client) => {
    const record = await insertRecord(client, {
      equipmentId: input.equipmentId,
      cleanedBy: input.cleanedBy,
      cleanedAt: input.cleanedAt,
      methodId: input.methodId,
      notes: input.notes ?? null,
    });

    // `before = null` marks a create: every populated field is recorded with
    // no old value, which is what gives an inspector the record's origin.
    const changes = diffRecord(null, auditableProjection(record), CLEANING_RECORD_FIELDS);
    await writeAudit(client, {
      recordId: record.id,
      action: 'create',
      actorId,
      changes,
    });

    return record;
  });
}

export interface AmendInput {
  cleanedBy?: string | undefined;
  cleanedAt?: string | undefined;
  methodId?: string | undefined;
  notes?: string | null | undefined;
  notesProvided: boolean;
  status?: CleaningStatus | undefined;
  reason?: string | undefined;
}

export async function amendCleaningRecord(
  recordId: string,
  input: AmendInput,
  actorId: string,
): Promise<CleaningRecord> {
  // Resolve the display values the trail will store before opening the
  // transaction, so lookups do not hold the row lock.
  let methodCode: string | undefined;
  if (input.methodId !== undefined) {
    const method = await findMethod(input.methodId);
    if (method === null) throw notFound('Cleaning method');
    if (!method.isActive) {
      throw conflict(
        'METHOD_INACTIVE',
        `${method.code} is superseded and cannot be selected for new work.`,
      );
    }
    methodCode = method.code;
  }

  let cleanerName: string | undefined;
  if (input.cleanedBy !== undefined) {
    const cleaner = await findUser(input.cleanedBy);
    if (cleaner === null) throw notFound('User in cleanedBy');
    cleanerName = cleaner.name;
  }

  return withTransaction(async (client) => {
    if (!(await lockRecord(client, recordId))) throw notFound('Cleaning record');

    const before = await findRecord(recordId, client);
    if (before === null) throw notFound('Cleaning record');

    const beforeValues = auditableProjection(before);

    // Only the fields the request actually carried. Keys left out stay out, so
    // a one-field PATCH can only ever produce a one-field audit entry.
    const afterValues: Record<string, string | null | undefined> = {};
    if (cleanerName !== undefined) afterValues.cleanedBy = cleanerName;
    if (input.cleanedAt !== undefined) afterValues.cleanedAt = input.cleanedAt;
    if (methodCode !== undefined) afterValues.method = methodCode;
    if (input.notesProvided) afterValues.notes = input.notes ?? null;

    // Decided from the requested field changes, before status is resolved:
    // whether this edit invalidates an existing sign-off.
    const requestedChanges = diffRecord(
      beforeValues,
      afterValues as AuditableValues,
      CLEANING_RECORD_FIELDS,
    );
    const substantiveChange = requestedChanges.some((change) =>
      SUBSTANTIVE_FIELDS.includes(change.field),
    );

    const transition = evaluateTransition({
      currentStatus: before.status,
      currentCleanedBy: before.cleanedBy,
      requestedStatus: input.status,
      substantiveChange,
      actorId,
      reason: input.reason,
    });

    afterValues.status = transition.nextStatus;

    const changes = diffRecord(
      beforeValues,
      afterValues as AuditableValues,
      CLEANING_RECORD_FIELDS,
    );

    // Nothing actually changed. Return the record untouched rather than bumping
    // `updated_at` and writing a change set that reports no change.
    if (changes.length === 0) return before;

    const updated = await updateRecord(client, recordId, {
      cleanedBy: input.cleanedBy,
      cleanedAt: input.cleanedAt,
      methodId: input.methodId,
      notes: input.notes,
      notesProvided: input.notesProvided,
      status: transition.nextStatus,
    });

    await writeAudit(client, {
      recordId,
      action: 'update',
      actorId,
      // A system-forced revert supplies its own reason, so the trail always
      // explains why the sign-off disappeared.
      reason: input.reason ?? (transition.forcedRevert ? FORCED_REVERT_REASON : null),
      changes,
    });

    return updated;
  });
}

export async function getCleaningRecord(recordId: string): Promise<CleaningRecord> {
  const record = await findRecord(recordId);
  if (record === null) throw notFound('Cleaning record');
  return record;
}

/** Guard used by the routes that read a record's audit history. */
export async function assertRecordExists(recordId: string): Promise<void> {
  const record = await findRecord(recordId);
  if (record === null) throw new AppError(404, 'NOT_FOUND', 'Cleaning record not found');
}
