/* Миграция 003_drop_beta_settings на одноразовом PostgreSQL.
   Запускается только с явным адресом одноразового сервера, иначе пропускается:

     RIZZOMA_SCRATCH_DATABASE_URL=postgresql://postgres:…@127.0.0.1:55432/postgres \
       node --test tests/beta-migration.db.test.mjs

   Тест создаёт свои базы rizzoma_scratch_* и удаляет их в конце; чужие базы
   не трогает. Миграции применяет настоящий раннер apps/api/src/db/migrate.ts.
   Адрес принимается только локальный: контуры dev/prod сюда не подключить. */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'db/migrations');
const ADMIN_URL = process.env.RIZZOMA_SCRATCH_DATABASE_URL || '';
const LOCAL = ['127.0.0.1', 'localhost', '[::1]'];
const skip = !ADMIN_URL ? 'RIZZOMA_SCRATCH_DATABASE_URL не задан' :
  !LOCAL.includes(new URL(ADMIN_URL).hostname) ? 'нужен локальный одноразовый PostgreSQL' : false;

const suffix = crypto.randomBytes(4).toString('hex');
const dbs = {clean:`rizzoma_scratch_${suffix}_clean`, upgrade:`rizzoma_scratch_${suffix}_upgrade`};
const urlOf = name => { const u = new URL(ADMIN_URL); u.pathname = '/' + name; return u.toString(); };

async function withClient(url, work){
  const client = new pg.Client({connectionString:url});
  await client.connect();
  try { return await work(client); } finally { await client.end(); }
}

/* Настоящий раннер с синтетическим окружением: config.ts требует все
   обязательные переменные. cwd — пустой каталог, чтобы dotenv не подхватил
   чей-нибудь .env с адресом реального контура. */
function runMigrations(name){
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rizzoma-migrate-'));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'),
      path.join(ROOT, 'apps/api/src/db/migrate.ts')], {
      cwd, encoding:'utf8', timeout:60_000,
      env:{PATH:process.env.PATH, HOME:process.env.HOME || cwd, TMPDIR:os.tmpdir(),
        APP_ENV:'dev', DEV_ALLOWED_TG_IDS:'1', BOT_TOKEN:'scratch-token-0000000000',
        ALLOWED_ORIGINS:'https://scratch.invalid', DATABASE_URL:urlOf(name)}
    });
    assert.equal(r.status, 0, 'раннер миграций упал:\n' + r.stderr);
    return r.stdout.split('\n').filter(line => line.startsWith('applied ')).map(line => line.slice(8));
  } finally { fs.rmSync(cwd, {recursive:true, force:true}); }
}

const sql = name => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

/* Состояние пользователей без чтения содержимого: число строк, хэш
   упорядоченных идентификаторов, число отозванных доступов. */
async function userState(client){
  const one = async q => (await client.query(q)).rows[0];
  const out = {};
  for(const [table, key] of [
    ['users','id'], ['participant_registrations','user_id'], ['api_sessions','id'],
    ['invoice_intents','id'], ['payment_receipts','telegram_payment_charge_id'],
    ['engagement_accounts','telegram_user_id'], ['engagement_awards','id']
  ]){
    out[table] = await one(`SELECT count(*)::int AS n,
      md5(coalesce(string_agg(${key}::text, ',' ORDER BY ${key}::text), '')) AS ids FROM ${table}`);
  }
  out.revoked = (await one(`SELECT count(*) FILTER (WHERE access_revoked_at IS NOT NULL)::int AS n
    FROM participant_registrations`)).n;
  return out;
}

before(async () => {
  if(skip) return;
  await withClient(ADMIN_URL, async c => {
    for(const name of Object.values(dbs)) await c.query(`CREATE DATABASE ${name}`);
  });
});
after(async () => {
  if(skip) return;
  await withClient(ADMIN_URL, async c => {
    for(const name of Object.values(dbs)) await c.query(`DROP DATABASE IF EXISTS ${name}`);
  });
});

// без БД: идёт и в CI
test('002 не редактировалась, 003 только удаляет beta_settings', () => {
  // контрольная сумма из schema_migrations контуров, применивших 002
  assert.equal(sha(sql('002_persistent_bot_state.sql')),
    '86c306ec4b4b6310e254b173d23d06bd55a37500f7c9ecfe921b11ca63873565');
  const body = sql('003_drop_beta_settings.sql').split('\n').filter(l => l.trim() && !l.startsWith('--'));
  assert.deepEqual(body, ['DROP TABLE beta_settings;']);
});

test('чистая БД: применяются 001, 002, 003, таблицы beta_settings нет', {skip}, async () => {
  assert.deepEqual(runMigrations(dbs.clean),
    ['001_identity.sql', '002_persistent_bot_state.sql', '003_drop_beta_settings.sql']);
  await withClient(urlOf(dbs.clean), async c => {
    assert.equal((await c.query(`SELECT to_regclass('public.beta_settings') AS t`)).rows[0].t, null);
    assert.equal((await c.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, 3);
  });
});

test('обновление контура с 002: применяется только 003, пользователи не меняются', {skip}, async () => {
  const url = urlOf(dbs.upgrade);
  // Контур, где раннер уже применил 001 и 002: та же схема schema_migrations
  // и те же контрольные суммы, что пишет apps/api/src/db/migrate.ts.
  let before;
  await withClient(url, async c => {
    await c.query(`CREATE TABLE schema_migrations (name text PRIMARY KEY,
      checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    for(const name of ['001_identity.sql', '002_persistent_bot_state.sql']){
      await c.query(sql(name));
      await c.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, sha(sql(name))]);
    }
    await c.query(`INSERT INTO beta_settings (id, beta_open, updated_by_telegram_user_id) VALUES (1, '{0,1,3,4}', 777)`);
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    await c.query(`INSERT INTO users (id, telegram_user_id, first_name) VALUES ($1, 101, 'A'), ($2, 102, 'B')`, [a, b]);
    await c.query(`INSERT INTO participant_registrations
      (user_id, referral_code, referred_by_user_id, first_source, bot_registered_at, access_revoked_at)
      VALUES ($1, 'AAAAA1', NULL, 'bot', now(), NULL), ($2, 'BBBBB2', $1, 'bot', now(), now())`, [a, b]);
    await c.query(`INSERT INTO api_sessions (id, user_id, token_hash, expires_at)
      VALUES ($1, $2, $3, now() + interval '15 minutes')`, [crypto.randomUUID(), a, crypto.randomBytes(32)]);
    const invoice = crypto.randomUUID();
    await c.query(`INSERT INTO invoice_intents (id, user_id, amount_minor, currency, ticket_class, ticket_size, status)
      VALUES ($1, $2, 80000, 'RUB', 'std', 'solo', 'paid')`, [invoice, b]);
    await c.query(`INSERT INTO payment_receipts (telegram_payment_charge_id, invoice_id, user_id, amount_minor, currency)
      VALUES ('charge-1', $1, $2, 80000, 'RUB')`, [invoice, b]);
    await c.query(`INSERT INTO engagement_accounts (telegram_user_id) VALUES (101)`);
    await c.query(`INSERT INTO engagement_awards (id, telegram_user_id, dedup_key, rule, points)
      VALUES ($1, 101, 'join:101', 'join', 5)`, [crypto.randomUUID()]);
    before = await userState(c);
  });
  assert.equal(before.users.n, 2);
  assert.equal(before.revoked, 1);

  assert.deepEqual(runMigrations(dbs.upgrade), ['003_drop_beta_settings.sql']);

  await withClient(url, async c => {
    assert.equal((await c.query(`SELECT to_regclass('public.beta_settings') AS t`)).rows[0].t, null);
    const checksum = (await c.query(`SELECT checksum FROM schema_migrations WHERE name = '002_persistent_bot_state.sql'`)).rows[0].checksum;
    assert.equal(checksum, sha(sql('002_persistent_bot_state.sql')));
    assert.deepEqual(await userState(c), before);

    // Причина порядка выкладки: код до переноса после 003 падает на таблице.
    await assert.rejects(c.query('SELECT beta_open FROM beta_settings WHERE id = 1'), {code:'42P01'});
    await assert.rejects(c.query(`INSERT INTO beta_settings (id, beta_open) VALUES (1, '{0}') ON CONFLICT (id) DO NOTHING`), {code:'42P01'});
  });
});

test('повторный запуск раннера ничего не применяет', {skip}, async () => {
  assert.deepEqual(runMigrations(dbs.upgrade), []);
  assert.deepEqual(runMigrations(dbs.clean), []);
});
