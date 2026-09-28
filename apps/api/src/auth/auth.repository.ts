import { randomInt, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { DatabasePool } from '../db/pool.js';
import type { TelegramUser } from './telegram-init-data.js';
import type { RegistrationRecord, RegistrationSource, UserRecord } from './auth.models.js';

interface UserRow extends QueryResultRow {
  id: string;
  telegram_user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  status: UserRecord['status'];
}

interface RegistrationRow extends QueryResultRow {
  referral_code: string;
  created_at: Date | string;
}

const referralAlphabet = 'ACDEFHJKLMNPRTUVWXY3479';

function newReferralCode(): string {
  return Array.from({ length: 6 }, () => referralAlphabet[randomInt(referralAlphabet.length)]).join('');
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    status: row.status
  };
}

async function transaction<T>(pool: DatabasePool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresAuthRepository {
  constructor(private readonly pool: DatabasePool) {}

  async registerUser(
    user: TelegramUser,
    source: RegistrationSource,
    referredByCode?: string
  ): Promise<RegistrationRecord> {
    return transaction(this.pool, async (client) => {
      const userResult = await client.query<UserRow>(
        `INSERT INTO users
           (id, telegram_user_id, username, first_name, last_name, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (telegram_user_id) DO UPDATE SET
           username = EXCLUDED.username,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           last_seen_at = now(),
           updated_at = now()
         RETURNING id, telegram_user_id, username, first_name, last_name, status`,
        [randomUUID(), user.id, user.username, user.firstName, user.lastName]
      );
      const row = userResult.rows[0];
      if (!row) throw new Error('User upsert did not return a row');

      // Serializes simultaneous Mini App and bot registration for one user.
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [row.id]);
      const existing = await client.query<RegistrationRow>(
        'SELECT referral_code, created_at FROM participant_registrations WHERE user_id = $1',
        [row.id]
      );
      const referrer = referredByCode
        ? await client.query<{ user_id: string; referral_code: string }>(
          `SELECT user_id, referral_code FROM participant_registrations
           WHERE referral_code = $1 AND user_id <> $2`,
          [referredByCode, row.id]
        )
        : undefined;
      const referrerId = referrer?.rows[0]?.user_id ?? null;

      if (existing.rows[0]) {
        await client.query(
          `UPDATE participant_registrations SET
             referred_by_user_id = COALESCE(referred_by_user_id, $1),
             mini_app_registered_at = CASE WHEN $2::text = 'mini_app' THEN COALESCE(mini_app_registered_at, now()) ELSE mini_app_registered_at END,
             bot_registered_at = CASE WHEN $2::text = 'bot' THEN COALESCE(bot_registered_at, now()) ELSE bot_registered_at END,
             updated_at = now()
           WHERE user_id = $3`,
          [referrerId, source, row.id]
        );
        const savedReferrer = await client.query<{ referral_code: string }>(
          `SELECT inviter.referral_code
           FROM participant_registrations own
           JOIN participant_registrations inviter ON inviter.user_id = own.referred_by_user_id
           WHERE own.user_id = $1`,
          [row.id]
        );
        return {
          user: mapUser(row),
          created: false,
          source,
          referralCode: existing.rows[0].referral_code,
          referredByCode: savedReferrer.rows[0]?.referral_code ?? null,
          registeredAt: new Date(existing.rows[0].created_at).toISOString()
        };
      }

      for (let attempt = 0; attempt < 16; attempt += 1) {
        const referralCode = newReferralCode();
        const inserted = await client.query<RegistrationRow>(
          `INSERT INTO participant_registrations
             (user_id, referral_code, referred_by_user_id, first_source,
              mini_app_registered_at, bot_registered_at)
           VALUES ($1, $2, $3, $4,
                   CASE WHEN $4::varchar = 'mini_app' THEN now() END,
                   CASE WHEN $4::varchar = 'bot' THEN now() END)
           ON CONFLICT (referral_code) DO NOTHING
           RETURNING referral_code, created_at`,
          [row.id, referralCode, referrerId, source]
        );
        if (inserted.rows[0]) {
          return {
            user: mapUser(row),
            created: true,
            source,
            referralCode: inserted.rows[0].referral_code,
            referredByCode: referrer?.rows[0]?.referral_code ?? null,
            registeredAt: new Date(inserted.rows[0].created_at).toISOString()
          };
        }
      }
      throw new Error('Unable to allocate a unique referral code');
    });
  }

  async createSession(input: { userId: string; tokenHash: Buffer; expiresAt: Date }): Promise<void> {
    await this.pool.query(
      `INSERT INTO api_sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), input.userId, input.tokenHash, input.expiresAt]
    );
  }

  async findActiveSession(tokenHash: Buffer): Promise<UserRecord | null> {
    return transaction(this.pool, async (client) => {
      const result = await client.query<UserRow & { session_id: string }>(
        `SELECT s.id AS session_id, u.id, u.telegram_user_id, u.username,
                u.first_name, u.last_name, u.status
         FROM api_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
           AND u.status = 'active'
         LIMIT 1
         FOR UPDATE OF s`,
        [tokenHash]
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query('UPDATE api_sessions SET last_used_at = now() WHERE id = $1', [row.session_id]);
      return mapUser(row);
    });
  }
}
