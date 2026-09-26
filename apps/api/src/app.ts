import express, { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { BotRegistrationRequestSchema, TelegramRegistrationRequestSchema } from '@rizzoma/contracts';
import type { AppConfig } from './config.js';
import { databaseReady, type DatabasePool } from './db/pool.js';
import { PostgresAuthRepository } from './auth/auth.repository.js';
import { AuthService } from './auth/auth.service.js';
import { AppError } from './http/app-error.js';
import { parseBody } from './http/request.js';
import { errorHandler, requestContext } from './observability/error-handler.js';

function cors(config: AppConfig): RequestHandler {
  return (request, response, next) => {
    const origin = request.header('origin');
    if (origin && !config.allowedOrigins.has(origin)) return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Origin is not allowed'));
    if (origin) response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
    response.setHeader('access-control-allow-headers', 'Authorization, Content-Type, X-Request-Id, X-Rizzoma-Bot-Timestamp, X-Rizzoma-Bot-Signature');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    next();
  };
}

export function createApp(config: AppConfig, pool: DatabasePool): express.Express {
  const app = express();
  if (config.trustProxyHops) app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.use(requestContext, helmet(), cors(config), express.json({ limit: '16kb' }));

  const repository = new PostgresAuthRepository(pool);
  const auth = new AuthService(repository, {
    botToken: config.botToken,
    telegramAuthMaxAgeSeconds: config.telegramAuthMaxAgeSeconds,
    sessionTtlSeconds: config.sessionTtlSeconds
  });
  const registrationLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
  // All bot calls originate from one container address. A per-IP limit of 30
  // would throttle unrelated participants during a small event burst.
  const botRegistrationLimit = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false });

  app.get('/health/live', (_request, response) => response.json({ status: 'ok' }));
  app.get('/health/ready', async (_request, response) => {
    const ready = await databaseReady(pool);
    response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });

  app.post('/api/v1/registrations/telegram', registrationLimit, async (request, response) => {
    const input = parseBody(TelegramRegistrationRequestSchema, request);
    response.status(200).json(await auth.registerMiniApp(input.initData, input.referralCode));
  });

  app.post('/api/v1/registrations/bot', botRegistrationLimit, async (request, response) => {
    const input = parseBody(BotRegistrationRequestSchema, request);
    const timestamp = String(request.header('x-rizzoma-bot-timestamp') ?? '');
    const signature = String(request.header('x-rizzoma-bot-signature') ?? '');
    response.status(200).json(await auth.registerBot(input, timestamp, signature));
  });

  app.get('/api/v1/me', async (request, response) => {
    const header = String(request.header('authorization') ?? '');
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) throw new AppError(401, 'AUTH_REQUIRED', 'Authorization is required');
    response.json(await auth.authenticate(match[1]));
  });

  app.use((_request, _response, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler);
  return app;
}
