import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';
import { findUser } from '../repos/users.js';
import type { User } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: User;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the acting user from the `X-User-Id` header.
 *
 * This stands in for real authentication, which is out of scope. It is
 * deliberately a resolved *user row* rather than a trusted string: the audit
 * trail's "who" must be a real person in the system, so an unknown id is
 * rejected rather than recorded. Swapping this for a session or JWT means
 * changing this one file -- nothing downstream knows where the actor came from.
 */
export async function attachCurrentUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header('x-user-id');
  if (header === undefined || header === '') {
    next();
    return;
  }

  if (!UUID_RE.test(header)) {
    next(new AppError(400, 'INVALID_USER', 'X-User-Id is not a valid user id.'));
    return;
  }

  try {
    const user = await findUser(header);
    if (user === null) {
      next(new AppError(401, 'UNKNOWN_USER', 'X-User-Id does not match a known user.'));
      return;
    }
    req.actor = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Reads the actor for a write. Every mutation is attributable, so a write
 * without an identified user is refused rather than defaulted -- an audit entry
 * naming "system" would be worthless to an inspector.
 */
export function requireActor(req: Request): User {
  if (req.actor === undefined) {
    throw new AppError(
      401,
      'USER_REQUIRED',
      'This action changes an audited record and requires an X-User-Id header.',
    );
  }
  return req.actor;
}
