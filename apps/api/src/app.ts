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
  // Keep route matching aligned with nginx's exact public-route exclusions.
  app.enable('case sensitive routing');
  app.enable('strict routing');
  if (config.trustProxyHops) app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.use(requestContext, helmet(), cors(config), express.json({ limit: '16kb' }));

  const repository = new PostgresAuthRepository(pool);
  const auth = new AuthService(repository, {
    botToken: config.botToken,
    allowedTelegramIds: config.appEnv === 'dev' ? config.devAllowedTgIds : undefined,
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

  const cookieName = `__Host-rizzoma-${config.appEnv}`;
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });

  app.post('/api/v1/registrations/telegram', registrationLimit, async (request, response) => {
    const input = parseBody(TelegramRegistrationRequestSchema, request);
    const result = await auth.registerMiniApp(input.initData, input.referralCode);
    response.cookie(cookieName, result.accessToken, {
      httpOnly: true, secure: true, sameSite: 'strict', path: '/',
      maxAge: config.sessionTtlSeconds * 1000
    });
    const { accessToken: _accessToken, ...participant } = result;
    response.status(200).json(participant);
  });

  app.post('/api/v1/registrations/bot', botRegistrationLimit, async (request, response) => {
    const input = parseBody(BotRegistrationRequestSchema, request);
    const timestamp = String(request.header('x-rizzoma-bot-timestamp') ?? '');
    const signature = String(request.header('x-rizzoma-bot-signature') ?? '');
    response.status(200).json(await auth.registerBot(input, timestamp, signature));
  });

  const session: RequestHandler = async (request, response, next) => {
    const cookies = String(request.header('cookie') ?? '').split(';').map(value => value.trim());
    const token = cookies.find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!token) throw new AppError(401, 'AUTH_REQUIRED', 'Authorization is required');
    response.locals.identity = await auth.authenticate(token);
    next();
  };
  // All subsequently added v1 endpoints inherit session protection.
  app.use('/api/v1', session);
  app.get('/api/v1/me', (_request, response) => response.json(response.locals.identity));
  app.get('/api/v1/session', (_request, response) => response.sendStatus(204));

  app.use((_request, _response, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler);
  return app;
}
