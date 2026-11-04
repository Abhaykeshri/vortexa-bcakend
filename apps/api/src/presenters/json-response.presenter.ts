import type { Response } from 'express';
import { responseWithRequestId } from '../http-security.js';

/** Sends a JSON response using the request-scoped identifier established by middleware. */
export function presentJson(res: Response, status: number, data: unknown): void {
  if (status === 204) {
    res.status(status).end();
    return;
  }
  res.status(status).json(responseWithRequestId(data, res.locals.requestId as string));
}
