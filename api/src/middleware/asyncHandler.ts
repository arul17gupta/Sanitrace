import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not forward a rejected promise to the error middleware, so an
 * async handler that throws would hang the request. Wrapping every handler
 * keeps the single error shape in errors.ts as the only place failures are
 * rendered.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
