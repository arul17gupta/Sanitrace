import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/**
 * Every failure the API reports deliberately goes through one shape:
 *
 *   { "error": { "code": "REASON_REQUIRED", "message": "...", "details": ... } }
 *
 * A stable machine-readable `code` is what lets the front-end react to a
 * specific rule (for example, prompting for a reason) without string-matching
 * on prose.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) =>
  new AppError(404, 'NOT_FOUND', `${what} not found`);

export const conflict = (code: string, message: string) =>
  new AppError(409, code, message);

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505';

function isPgError(error: unknown): error is { code: string; constraint?: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express needs the 4-arg shape
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request body or query is invalid',
        // Flattened to { field: [messages] } so a form can show errors inline.
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }

  if (isPgError(error) && error.code === UNIQUE_VIOLATION) {
    res.status(409).json({
      error: {
        code: 'DUPLICATE_VALUE',
        message: `A record with that value already exists (${error.constraint ?? 'unique constraint'})`,
      },
    });
    return;
  }

  // The audit triggers raise a plain exception; surface it as a 409 rather than
  // an opaque 500, because it means someone tried to rewrite history.
  if (error instanceof Error && error.message.includes('audit trail is append-only')) {
    res.status(409).json({
      error: { code: 'AUDIT_TRAIL_IMMUTABLE', message: error.message },
    });
    return;
  }

  console.error('[unhandled]', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  });
}
