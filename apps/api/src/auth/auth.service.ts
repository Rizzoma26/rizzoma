import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthResponse, BotRegistrationRequest, BotRegistrationResponse } from '@rizzoma/contracts';
import { AppError } from '../http/app-error.js';
import type { PostgresAuthRepository } from './auth.repository.js';
import { validateTelegramInitData } from './telegram-init-data.js';

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export class AuthService {
  constructor(
    private readonly repository: PostgresAuthRepository,
    private readonly options: {
      botToken: string;
      telegramAuthMaxAgeSeconds: number;
      sessionTtlSeconds: number;
      now?: () => Date;
    }
  ) {}

  async registerMiniApp(initData: string, referralCode?: string): Promise<AuthResponse> {
    const now = this.options.now?.() ?? new Date();
    const telegramUser = validateTelegramInitData(initData, {
      botToken: this.options.botToken,
      maxAgeSeconds: this.options.telegramAuthMaxAgeSeconds,
      now
    });
    const registration = await this.repository.registerUser(telegramUser, 'mini_app', referralCode);
    if (registration.user.status !== 'active') throw new AppError(403, 'USER_BLOCKED', 'User is not allowed to sign in');

    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlSeconds * 1_000);
    await this.repository.createSession({ userId: registration.user.id, tokenHash: hashToken(accessToken), expiresAt });
    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: registration.user.id,
        telegramUserId: registration.user.telegramUserId,
        username: registration.user.username,
        firstName: registration.user.firstName,
        lastName: registration.user.lastName
      },
      registration: {
        created: registration.created,
        source: registration.source,
        referralCode: registration.referralCode,
        referredByCode: registration.referredByCode,
        registeredAt: registration.registeredAt
      }
    };
  }

  async registerBot(input: BotRegistrationRequest, timestamp: string, signature: string): Promise<BotRegistrationResponse> {
    const now = this.options.now?.() ?? new Date();
    const timestampSeconds = Number(timestamp);
    if (!Number.isInteger(timestampSeconds) || Math.abs(Math.floor(now.getTime() / 1_000) - timestampSeconds) > 90
      || !/^[0-9a-f]{64}$/i.test(signature)) {
      throw new AppError(401, 'INVALID_BOT_SIGNATURE', 'Bot registration signature is invalid');
    }
    const canonical = JSON.stringify({
      telegramUser: input.telegramUser,
      referralCode: input.referralCode ?? null
    });
    const expected = createHmac('sha256', this.options.botToken).update(`${timestamp}.${canonical}`).digest();
    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new AppError(401, 'INVALID_BOT_SIGNATURE', 'Bot registration signature is invalid');
    }

    const registration = await this.repository.registerUser(input.telegramUser, 'bot', input.referralCode);
    if (registration.user.status !== 'active') throw new AppError(403, 'USER_BLOCKED', 'User is not allowed to register');
    return {
      user: {
        id: registration.user.id,
        telegramUserId: registration.user.telegramUserId,
        username: registration.user.username,
        firstName: registration.user.firstName,
        lastName: registration.user.lastName
      },
      registration: {
        created: registration.created,
        source: registration.source,
        referralCode: registration.referralCode,
        referredByCode: registration.referredByCode,
        registeredAt: registration.registeredAt
      }
    };
  }

  async authenticate(accessToken: string): Promise<{ userId: string; telegramUserId: string }> {
    if (accessToken.length < 32 || accessToken.length > 256) {
      throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid');
    }
    const user = await this.repository.findActiveSession(hashToken(accessToken));
    if (!user) throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid or expired');
    return { userId: user.id, telegramUserId: user.telegramUserId };
  }
}
