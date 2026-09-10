import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireActor } from '../middleware/currentUser.js';
import { notFound } from '../errors.js';
import { decodeCursor, parseLimit } from '../pagination.js';
import { findEquipment } from '../repos/equipment.js';
import { listRecordsByEquipment } from '../repos/cleaningRecords.js';
import { listAuditHistory } from '../repos/audit.js';
import {
  amendCleaningRecord,
  assertRecordExists,
  createCleaningRecord,
  getCleaningRecord,
} from '../services/cleaningRecords.js';

const idParam = z.string().uuid();
const statusFilter = z.enum(['pending', 'verified']).optional();

/**
 * Contemporaneous recording -- the "C" in ALCOA. A cleaning that has not
 * happened yet cannot be logged, so a future timestamp is a validation error
 * rather than something to be caught later in review. A minute of slack absorbs
 * clock skew between the browser and the server.
 */
const notInFuture = (value: string) => Date.parse(value) <= Date.now() + 60_000;

const isoTimestamp = z
  .string()
  .datetime({ offset: true })
  .refine(notInFuture, { message: 'cleanedAt cannot be in the future' });

const createBody = z.object({
  cleanedBy: z.string().uuid(),
  cleanedAt: isoTimestamp,
  methodId: z.string().uuid(),
  notes: z.string().trim().max(1000).nullish(),
});

const patchBody = z
  .object({
    cleanedBy: z.string().uuid().optional(),
    cleanedAt: isoTimestamp.optional(),
    methodId: z.string().uuid().optional(),
    // `.nullable().optional()` is load-bearing: an absent key leaves the field
    // alone, while an explicit null clears it. Collapsing the two would make it
    // impossible to erase a note.
    notes: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(['pending', 'verified']).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update',
  });

/** Nested under /api/equipment. */
export const equipmentRecordsRouter = Router();

equipmentRecordsRouter.get(
  '/:equipmentId/cleaning-records',
  asyncHandler(async (req, res) => {
    const equipmentId = idParam.parse(req.params.equipmentId);
    if ((await findEquipment(equipmentId)) === null) throw notFound('Equipment');

    const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const page = await listRecordsByEquipment({
      equipmentId,
      status: statusFilter.parse(req.query.status ?? undefined),
      limit: parseLimit(req.query.limit),
      cursor: rawCursor === undefined ? undefined : decodeCursor(rawCursor, 'timestamp'),
    });

    res.json(page);
  }),
);

equipmentRecordsRouter.post(
  '/:equipmentId/cleaning-records',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req);
    const equipmentId = idParam.parse(req.params.equipmentId);
    const body = createBody.parse(req.body);

    const record = await createCleaningRecord(
      {
        equipmentId,
        cleanedBy: body.cleanedBy,
        cleanedAt: body.cleanedAt,
        methodId: body.methodId,
        notes: body.notes ?? null,
      },
      actor.id,
    );

    res.status(201).json(record);
  }),
);

/** Mounted at /api/cleaning-records. */
export const cleaningRecordsRouter = Router();

cleaningRecordsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getCleaningRecord(idParam.parse(req.params.id)));
  }),
);

cleaningRecordsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req);
    const id = idParam.parse(req.params.id);
    const body = patchBody.parse(req.body);

    const record = await amendCleaningRecord(
      id,
      {
        cleanedBy: body.cleanedBy,
        cleanedAt: body.cleanedAt,
        methodId: body.methodId,
        notes: body.notes,
        // Presence, not value: this is how "clear the note" survives the trip
        // from JSON through to the UPDATE statement.
        notesProvided: 'notes' in body,
        status: body.status,
        reason: body.reason,
      },
      actor.id,
    );

    res.json(record);
  }),
);

cleaningRecordsRouter.get(
  '/:id/audit',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    await assertRecordExists(id);

    const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const page = await listAuditHistory({
      recordId: id,
      limit: parseLimit(req.query.limit),
      cursor: rawCursor === undefined ? undefined : decodeCursor(rawCursor, 'timestamp'),
    });

    res.json(page);
  }),
);
