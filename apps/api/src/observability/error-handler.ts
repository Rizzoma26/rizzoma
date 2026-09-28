import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../http/app-error.js';

export const requestContext: RequestHandler = (request, response, next) => {
  const requestId = /^[0-9a-f-]{36}$/i.test(String(request.header('x-request-id') ?? ''))
    ? String(request.header('x-request-id'))
    : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
};

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  const requestId = String(response.locals.requestId ?? randomUUID());
  const bodyError = error instanceof SyntaxError && 'status' in error && error.status === 400;
  const tooLarge = error instanceof Error && 'status' in error && error.status === 413;
  const appError = error instanceof AppError
    ? error
    : bodyError ? new AppError(400, 'INVALID_JSON', 'Request body is invalid')
    : tooLarge ? new AppError(413, 'BODY_TOO_LARGE', 'Request body is too large')
    : new AppError(500, 'INTERNAL_ERROR', 'Internal server error');
  const sqlState = error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code : undefined;

  console.error(JSON.stringify({
    level: 'error',
    event: 'request_failed',
    requestId,
    method: request.method,
    route: request.route?.path ?? '<unmatched>',
    status: appError.status,
    code: appError.code,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    ...(sqlState ? { sqlState } : {})
  }));

  response.status(appError.status).json({
    error: { code: appError.code, message: appError.message, requestId }
  });
};
