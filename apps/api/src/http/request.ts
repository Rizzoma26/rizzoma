import type { Request } from 'express';
import type { ZodType } from 'zod';
import { AppError } from './app-error.js';

export function parseBody<T>(schema: ZodType<T>, request: Request): T {
  const result = schema.safeParse(request.body);
  if (!result.success) throw new AppError(400, 'INVALID_REQUEST', 'Request body is invalid');
  return result.data;
}
