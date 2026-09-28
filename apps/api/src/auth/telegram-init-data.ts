import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../http/app-error.js';

const TelegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1).max(128),
  last_name: z.string().max(128).optional(),
  username: z.string().max(64).optional()
}).passthrough();

export interface TelegramUser {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

export function validateTelegramInitData(
  initData: string,
  options: { botToken: string; maxAgeSeconds: number; now?: Date; maxFutureSkewSeconds?: number }
): TelegramUser {
  const params = new URLSearchParams(initData);
  if (new Set(params.keys()).size !== [...params.keys()].length) {
    throw new AppError(401, 'INVALID_TELEGRAM_AUTH', 'Duplicate authentication fields');
  }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw new AppError(401, 'INVALID_TELEGRAM_AUTH', 'Telegram authentication is invalid');
  }

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(options.botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new AppError(401, 'INVALID_TELEGRAM_AUTH', 'Telegram authentication is invalid');
  }

  const authDate = Number(params.get('auth_date'));
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  if (!Number.isInteger(authDate) || authDate <= 0
    || nowSeconds - authDate > options.maxAgeSeconds
    || authDate - nowSeconds > (options.maxFutureSkewSeconds ?? 60)) {
    throw new AppError(401, 'TELEGRAM_AUTH_EXPIRED', 'Telegram authentication has expired');
  }

  let rawUser: unknown;
  try { rawUser = JSON.parse(params.get('user') ?? 'null'); }
  catch { throw new AppError(401, 'INVALID_TELEGRAM_AUTH', 'Telegram user payload is invalid'); }
  const parsed = TelegramUserSchema.safeParse(rawUser);
  if (!parsed.success || !Number.isSafeInteger(parsed.data.id)) {
    throw new AppError(401, 'INVALID_TELEGRAM_AUTH', 'Telegram user payload is invalid');
  }
  return {
    id: String(parsed.data.id),
    firstName: parsed.data.first_name,
    lastName: parsed.data.last_name ?? null,
    username: parsed.data.username ?? null
  };
}
