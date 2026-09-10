import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireActor } from '../middleware/currentUser.js';
import { notFound } from '../errors.js';
import { decodeCursor, parseLimit } from '../pagination.js';
import {
  createEquipment,
  findEquipment,
  listEquipment,
  retireEquipment,
  updateEquipment,
} from '../repos/equipment.js';

const idParam = z.string().uuid();

const statusFilter = z.enum(['active', 'retired']).optional();

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  // The asset tag physically on the machine. Uppercased so that 'mt-003' and
  // 'MT-003' cannot become two different pieces of equipment.
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((value) => value.toUpperCase()),
  status: z.enum(['active', 'retired']).optional(),
});

const patchBody = createBody.partial().refine((body) => Object.keys(body).length > 0, {
  message: 'Provide at least one field to update',
});

export const equipmentRouter = Router();

equipmentRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = statusFilter.parse(req.query.status ?? undefined);
    const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const page = await listEquipment({
      status,
      limit: parseLimit(req.query.limit),
      cursor: rawCursor === undefined ? undefined : decodeCursor(rawCursor, 'text'),
    });

    res.json(page);
  }),
);

equipmentRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const equipment = await findEquipment(idParam.parse(req.params.id));
    if (equipment === null) throw notFound('Equipment');
    res.json(equipment);
  }),
);

equipmentRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    requireActor(req);
    const body = createBody.parse(req.body);
    const equipment = await createEquipment(body);
    res.status(201).json(equipment);
  }),
);

equipmentRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    requireActor(req);
    const id = idParam.parse(req.params.id);
    const body = patchBody.parse(req.body);
    const equipment = await updateEquipment(id, body);
    if (equipment === null) throw notFound('Equipment');
    res.json(equipment);
  }),
);

/**
 * Retires rather than deletes. Cleaning history must outlive the machine, so
 * there is no route that removes the row -- the verb is DELETE because that is
 * what a client means, but the effect is a status change.
 */
equipmentRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    requireActor(req);
    const equipment = await retireEquipment(idParam.parse(req.params.id));
    if (equipment === null) throw notFound('Equipment');
    res.json(equipment);
  }),
);
