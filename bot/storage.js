import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const ENG = require('../engagement.js');

const { Pool } = pg;
const number = value => Number(value || 0);

export class PostgresBotStore {
  constructor(connectionString) {
    this.betaInitialization = null;
    this.pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 5000,
      query_timeout: 10000,
      application_name: 'rizzoma-bot'
    });
    this.pool.on('error', error => console.error('bot postgres idle error:', error.name));
  }

  async close() { await this.pool.end(); }
  async ready() { await this.pool.query('SELECT 1'); }

  async transaction(work) {
    const client = await this.pool.connect();
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

  async snapshot(telegramId) {
    const result = await this.pool.query(`
      SELECT u.id AS user_uuid, u.telegram_user_id::text AS id, u.status,
             concat_ws(' ', u.first_name, u.last_name) AS name,
             coalesce(u.username, '') AS username,
             r.referral_code AS code, inviter.referral_code AS invited_by,
             r.access_revoked_at IS NOT NULL AS revoked,
             extract(epoch FROM r.created_at) * 1000 AS ts,
             EXISTS (SELECT 1 FROM payment_receipts p WHERE p.user_id = u.id) AS paid,
             (SELECT count(DISTINCT child.user_id)
                FROM participant_registrations child
                JOIN payment_receipts p ON p.user_id = child.user_id
               WHERE child.referred_by_user_id = u.id) AS refs
        FROM users u
        JOIN participant_registrations r ON r.user_id = u.id
        LEFT JOIN participant_registrations inviter ON inviter.user_id = r.referred_by_user_id
       WHERE u.telegram_user_id = $1`, [telegramId]);
    const row = result.rows[0];
    return row ? {
      id: row.id, status: row.status, name: row.name || 'Узел', username: row.username,
      code: row.code, invitedBy: row.invited_by, paid: row.paid,
      revoked: row.revoked, refs: number(row.refs), ts: number(row.ts)
    } : null;
  }

  async inviterFor(telegramId) {
    const result = await this.pool.query(`
      SELECT inviter.telegram_user_id::text AS id
      FROM users buyer
      JOIN participant_registrations own ON own.user_id = buyer.id
      JOIN users inviter ON inviter.id = own.referred_by_user_id
      WHERE buyer.telegram_user_id = $1`, [telegramId]);
    if (!result.rows[0]) return null;
    const inviter = await this.snapshot(result.rows[0].id);
    return inviter?.status === 'active' ? inviter : null;
  }

  async createInvoice(telegramId, {amount, currency, cls, size}) {
    const invoiceId = crypto.randomUUID();
    const result = await this.pool.query(`
      INSERT INTO invoice_intents (id, user_id, amount_minor, currency, ticket_class, ticket_size)
      SELECT $1, u.id, $3, $4, $5, $6 FROM users u
      JOIN participant_registrations r ON r.user_id = u.id
      WHERE u.telegram_user_id = $2 AND u.status = 'active' AND r.access_revoked_at IS NULL
      RETURNING id`, [invoiceId, telegramId, amount, currency, cls, size]);
    if (!result.rowCount) throw new Error('Participant is unavailable for invoice');
    return invoiceId;
  }

  async failInvoice(invoiceId) {
    await this.pool.query(`UPDATE invoice_intents SET status = 'failed', updated_at = now()
      WHERE id = $1 AND status = 'pending'`, [invoiceId]);
  }

  async invoiceForCheckout(invoiceId, telegramId) {
    const result = await this.pool.query(`
      SELECT i.amount_minor, i.currency FROM invoice_intents i
      JOIN users u ON u.id = i.user_id
      JOIN participant_registrations r ON r.user_id = u.id
      WHERE i.id = $1 AND u.telegram_user_id = $2 AND i.status = 'pending'
        AND u.status = 'active' AND r.access_revoked_at IS NULL`, [invoiceId, telegramId]);
    return result.rows[0] || null;
  }

  async recordPayment(telegramId, invoiceId, payment) {
    if (!payment.telegram_payment_charge_id || !invoiceId) throw new Error('Missing payment identity');
    const receipt = await this.transaction(async client => {
      const invoice = await client.query(`
        SELECT i.id, i.user_id, i.amount_minor, i.currency, i.status,
               i.ticket_class, i.ticket_size,
               u.telegram_user_id::text AS telegram_id
        FROM invoice_intents i JOIN users u ON u.id = i.user_id
        WHERE i.id = $1 FOR UPDATE OF i`, [invoiceId]);
      const row = invoice.rows[0];
      if (!row || row.telegram_id !== String(telegramId) ||
          number(row.amount_minor) !== payment.total_amount || row.currency !== payment.currency ||
          row.status === 'failed') throw new Error('Payment does not match invoice');
      const inserted = await client.query(`
        INSERT INTO payment_receipts
          (telegram_payment_charge_id, invoice_id, user_id, provider_payment_charge_id,
           amount_minor, currency)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (telegram_payment_charge_id) DO NOTHING
        RETURNING telegram_payment_charge_id`, [
          payment.telegram_payment_charge_id, invoiceId, row.user_id,
          payment.provider_payment_charge_id || null, payment.total_amount, payment.currency
        ]);
      if (!inserted.rowCount) {
        const existing = await client.query(`SELECT invoice_id, user_id FROM payment_receipts
          WHERE telegram_payment_charge_id = $1`, [payment.telegram_payment_charge_id]);
        if (existing.rows[0]?.invoice_id !== invoiceId || existing.rows[0]?.user_id !== row.user_id)
          throw new Error('Payment charge ID conflict');
        return {created: false, cls: row.ticket_class, size: row.ticket_size};
      }
      await client.query(`UPDATE invoice_intents SET status = 'paid', updated_at = now()
        WHERE id = $1`, [invoiceId]);
      return {created: true, cls: row.ticket_class, size: row.ticket_size};
    });
    return {...receipt, user: receipt.created ? await this.snapshot(telegramId) : null};
  }

  async friends(telegramId) {
    const result = await this.pool.query(`
      WITH me AS (
        SELECT u.id, r.referred_by_user_id FROM users u
        JOIN participant_registrations r ON r.user_id = u.id
        WHERE u.telegram_user_id = $1
      )
      SELECT u.telegram_user_id::text AS id,
             concat_ws(' ', u.first_name, u.last_name) AS name,
             coalesce(u.username, '') AS username,
             EXISTS (SELECT 1 FROM payment_receipts p WHERE p.user_id = u.id) AS paid
      FROM me JOIN participant_registrations r ON
        (r.referred_by_user_id = me.id OR
         (me.referred_by_user_id IS NOT NULL AND
          (r.user_id = me.referred_by_user_id OR r.referred_by_user_id = me.referred_by_user_id)))
      JOIN users u ON u.id = r.user_id
      WHERE u.id <> me.id AND u.status = 'active'
      ORDER BY r.created_at DESC`, [telegramId]);
    return result.rows.map(row => ({
      id: row.id, name: row.name || 'Узел', username: row.username,
      photo: '', status: row.paid ? 'paid' : 'node', tier: 0
    }));
  }

  async beta(defaultOpen) {
    if (!this.betaInitialization) {
      this.betaInitialization = this.pool.query(`INSERT INTO beta_settings (id, beta_open)
        VALUES (1, $1::smallint[]) ON CONFLICT (id) DO NOTHING`, [defaultOpen])
        .catch(error => { this.betaInitialization = null; throw error; });
    }
    await this.betaInitialization;
    const result = await this.pool.query('SELECT beta_open FROM beta_settings WHERE id = 1');
    return result.rows[0].beta_open.map(Number);
  }

  async setBeta(betaOpen, adminTelegramId) {
    const result = await this.pool.query(`UPDATE beta_settings SET beta_open = $1::smallint[],
      updated_by_telegram_user_id = $2, updated_at = now() WHERE id = 1
      RETURNING beta_open`, [betaOpen, adminTelegramId]);
    if (!result.rowCount) throw new Error('Beta settings were not initialized');
    return result.rows[0].beta_open.map(Number);
  }

  async setRevoked(telegramId, revoked) {
    const result = await this.pool.query(`UPDATE participant_registrations r
      SET access_revoked_at = CASE WHEN $2::boolean THEN coalesce(r.access_revoked_at, now()) ELSE NULL END,
          updated_at = now()
      FROM users u WHERE u.id = r.user_id AND u.telegram_user_id = $1
      RETURNING r.user_id`, [telegramId, revoked]);
    return !!result.rowCount;
  }

  async overview(defaultOpen) {
    const betaOpen = await this.beta(defaultOpen);
    const testers = await this.pool.query(`
      SELECT u.telegram_user_id::text AS id, concat_ws(' ', u.first_name, u.last_name) AS name,
             coalesce(u.username, '') AS username, r.referral_code AS code,
             inviter.referral_code AS invited_by, r.access_revoked_at IS NOT NULL AS revoked,
             EXISTS (SELECT 1 FROM payment_receipts p WHERE p.user_id = u.id) AS paid,
             (SELECT count(DISTINCT child.user_id) FROM participant_registrations child
              JOIN payment_receipts p ON p.user_id = child.user_id
              WHERE child.referred_by_user_id = u.id) AS refs,
             extract(epoch FROM r.created_at) * 1000 AS ts
      FROM users u JOIN participant_registrations r ON r.user_id = u.id
      LEFT JOIN participant_registrations inviter ON inviter.user_id = r.referred_by_user_id
      ORDER BY r.created_at DESC`);
    const payments = await this.pool.query(`
      SELECT extract(epoch FROM p.paid_at) * 1000 AS ts,
             u.telegram_user_id::text AS id, concat_ws(' ', u.first_name, u.last_name) AS name,
             coalesce(u.username, '') AS username, p.amount_minor AS amount,
             p.currency, i.ticket_class AS cls, i.ticket_size AS size,
             'paid' AS status, coalesce(p.provider_payment_charge_id, '') AS charge
      FROM payment_receipts p JOIN users u ON u.id = p.user_id
      JOIN invoice_intents i ON i.id = p.invoice_id
      ORDER BY p.paid_at DESC LIMIT 50`);
    const rows = testers.rows.map(row => ({
      id: row.id, name: row.name || 'Узел', username: row.username,
      code: row.code, invitedBy: row.invited_by, revoked: row.revoked,
      paid: row.paid, refs: number(row.refs), ts: number(row.ts)
    }));
    return {
      betaOpen, testers: rows,
      payments: payments.rows.map(row => ({...row, ts: number(row.ts)})),
      totals: {
        testers: rows.length,
        paid: rows.filter(row => row.paid).length,
        revoked: rows.filter(row => row.revoked).length
      }
    };
  }

  async engagement(telegramId) {
    const [balance, recent] = await Promise.all([
      this.pool.query(`SELECT coalesce(sum(points), 0)::integer AS points FROM engagement_awards
        WHERE telegram_user_id = $1 AND revoked_at IS NULL`, [telegramId]),
      this.pool.query(`SELECT dedup_key AS key, rule, points, subject,
        extract(epoch FROM created_at) * 1000 AS ts FROM engagement_awards
        WHERE telegram_user_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 20`, [telegramId])
    ]);
    return {points: number(balance.rows[0]?.points), events: recent.rows.map(row => ({
      key: row.key, rule: row.rule, points: row.points,
      subject: row.subject, ts: number(row.ts)
    }))};
  }

  async engagementChange(telegramId, rule, subject, kind) {
    const config = ENG.ruleOf(rule);
    const key = ENG.dedupKey(rule, telegramId, subject);
    if (!config || !key) return {ok: false, points: 0};
    return this.transaction(async client => {
      await client.query(`INSERT INTO engagement_accounts (telegram_user_id) VALUES ($1)
        ON CONFLICT DO NOTHING`, [telegramId]);
      await client.query('SELECT telegram_user_id FROM engagement_accounts WHERE telegram_user_id = $1 FOR UPDATE', [telegramId]);
      if (kind === 'revoke') {
        const removed = await client.query(`UPDATE engagement_awards SET revoked_at = now()
          WHERE telegram_user_id = $1 AND dedup_key = $2 AND revoked_at IS NULL
          RETURNING points`, [telegramId, key]);
        return {ok: !!removed.rowCount, points: number(removed.rows[0]?.points)};
      }
      const duplicate = await client.query(`SELECT 1 FROM engagement_awards
        WHERE telegram_user_id = $1 AND dedup_key = $2 AND revoked_at IS NULL`, [telegramId, key]);
      if (duplicate.rowCount) return {ok: false, points: 0};
      if (config.daily) {
        const cap = await client.query(`SELECT count(*)::integer AS n FROM engagement_awards
          WHERE telegram_user_id = $1 AND rule = $2 AND revoked_at IS NULL
            AND created_at > now() - interval '24 hours'`, [telegramId, rule]);
        if (number(cap.rows[0]?.n) >= config.daily) return {ok: false, points: 0};
      }
      await client.query(`INSERT INTO engagement_awards
        (id, telegram_user_id, dedup_key, rule, points, subject)
        VALUES ($1, $2, $3, $4, $5, $6)`, [
          crypto.randomUUID(), telegramId, key, rule, config.points,
          subject === undefined || subject === null ? null : String(subject)
        ]);
      return {ok: true, points: config.points};
    });
  }

  async health() {
    const result = await this.pool.query(`SELECT
      (SELECT count(*) FROM participant_registrations) AS users,
      (SELECT count(*) FROM payment_receipts) AS payments,
      (SELECT count(*) FROM engagement_accounts) AS engaged`);
    return {
      users: number(result.rows[0].users),
      payments: number(result.rows[0].payments),
      engaged: number(result.rows[0].engaged)
    };
  }
}
