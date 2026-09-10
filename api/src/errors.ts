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
 *
 * The handler below is also the place where anything thrown by a layer that
 * does not know about HTTP -- Postgres, the body parser -- is translated. Left
 * untranslated, those surface as a 500, which tells a caller nothing and hides
 * a client mistake behind what looks like a server fault.
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

/** Postgres error codes we can say something useful about. */
const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT_REPRESENTATION: '22P02',
  INVALID_DATETIME_FORMAT: '22007',
} as const;

/**
 * Unique constraints are named after their table and column, which is an
 * implementation detail. Mapping the ones we own back to a field name keeps
 * that out of the response and lets a form show the error against the input
 * that caused it.
 */
const UNIQUE_CONSTRAINT_FIELDS: Record<string, string> = {
  equipment_code_key: 'code',
  cleaning_methods_code_key: 'code',
};

interface PgError {
  code: string;
  constraint?: string;
  detail?: string;
}

function isPgError(error: unknown): error is PgError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

interface BodyParserError {
  status: number;
  type: string;
  message: string;
}

/** express.json failures: malformed JSON, a body over the size limit, and so on. */
function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    'status' in error &&
    typeof (error as { type: unknown }).type === 'string' &&
    (error as { type: string }).type.startsWith('entity.')
  );
}

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
    // fieldErrors keys off the failing field; formErrors holds object-level
    // failures from `.refine`, which have no field to attach to. Dropping
    // formErrors -- as flatten().fieldErrors alone does -- loses the only
    // explanation the caller would get, so they are surfaced in both the
    // message and the details.
    const { fieldErrors, formErrors } = error.flatten();
    const firstFormError = formErrors[0];

    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: firstFormError ?? 'Request body or query is invalid',
        details: {
          ...fieldErrors,
          ...(formErrors.length > 0 ? { _form: formErrors } : {}),
        },
      },
    });
    return;
  }

  if (isBodyParserError(error)) {
    if (error.type === 'entity.too.large') {
      res.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
      });
      return;
    }
    res.status(400).json({
      error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON.' },
    });
    return;
  }

  if (isPgError(error)) {
    switch (error.code) {
      case PG.UNIQUE_VIOLATION: {
        const field = error.constraint ? UNIQUE_CONSTRAINT_FIELDS[error.constraint] : undefined;
        res.status(409).json({
          error: {
            code: 'DUPLICATE_VALUE',
            message: field
              ? `That ${field} is already in use.`
              : 'A record with that value already exists.',
            ...(field ? { details: { [field]: ['already in use'] } } : {}),
          },
        });
        return;
      }

      case PG.FOREIGN_KEY_VIOLATION:
        // Referenced rows are checked before the write, so reaching here means
        // one was removed in between.
        res.status(409).json({
          error: {
            code: 'REFERENCE_MISSING',
            message: 'A referenced record no longer exists. Reload and try again.',
          },
        });
        return;

      case PG.CHECK_VIOLATION:
        res.status(400).json({
          error: {
            code: 'CONSTRAINT_VIOLATION',
            message: `The value breaks a database rule (${error.constraint ?? 'check constraint'}).`,
          },
        });
        return;

      case PG.INVALID_TEXT_REPRESENTATION:
      case PG.INVALID_DATETIME_FORMAT:
        // A parameter could not be cast -- in practice a hand-made or
        // cross-endpoint cursor. Cursors are validated on decode, so this is a
        // backstop rather than the primary guard.
        res.status(400).json({
          error: { code: 'INVALID_PARAMETER', message: 'A query parameter is not valid.' },
        });
        return;

      default:
        break;
    }
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
