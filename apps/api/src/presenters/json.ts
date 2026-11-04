import type { Response } from 'express';
import { responseWithRequestId } from '../security.js';

export function presentJson(res: Response, status: number, data: unknown): void {
  if (status === 204) {
    res.status(status).end();
    return;
  }
  res.status(status).json(responseWithRequestId(data, res.locals.requestId as string));
}
