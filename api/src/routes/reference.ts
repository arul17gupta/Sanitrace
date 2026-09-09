import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { listMethods } from '../repos/methods.js';
import { listUsers } from '../repos/users.js';

/**
 * Small reference lists that back the form controls. Unpaginated on purpose:
 * both are short, closed sets, and pretending otherwise would add a cursor the
 * UI would never use.
 */

export const methodsRouter = Router();

methodsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // Superseded procedures are visible only when explicitly asked for, so a
    // form cannot offer one by accident.
    const includeInactive = req.query.includeInactive === 'true';
    res.json({ data: await listMethods(!includeInactive) });
  }),
);

export const usersRouter = Router();

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: await listUsers() });
  }),
);
