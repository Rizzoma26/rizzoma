/* Неверная настройка беты останавливает запуск бота с понятной ошибкой.
   Запускается настоящий процесс bot/bot.js. cwd — пустой каталог, env — только
   перечисленные переменные: bot.js читает dotenv/config и иначе мог бы
   подхватить чей-нибудь .env. Проверка беты идёт до подключения к БД,
   поэтому адреса БД и сервиса регистрации намеренно недостижимы. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOT = path.join(ROOT, 'bot/bot.js');
const N = createRequire(import.meta.url)('../economy.js').TIERS.length;
const TOKEN = '424242:synthetic-startup-token-never-printed';
const DB_URL = 'postgresql://scratch_user:scratch_secret@127.0.0.1:9/nowhere';

function start(APP_ENV, BETA_OPEN){
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rizzoma-bot-start-'));
  const env = {
    PATH: process.env.PATH, APP_ENV, DEV_ALLOWED_TG_IDS: '42', PAYMENT_MODE: 'disabled',
    APP_URL: 'https://app.invalid', CORS_ORIGIN: 'https://app.invalid', BOT_TOKEN: TOKEN,
    REGISTRATION_API_BASE: 'http://127.0.0.1:9', DATABASE_URL: DB_URL, PORT: '0'
  };
  if(BETA_OPEN !== undefined) env.BETA_OPEN = BETA_OPEN;
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn(process.execPath, [BOT], {cwd, env, stdio:['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const kill = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.on('exit', (code, signal) => {
      clearTimeout(kill);
      fs.rmSync(cwd, {recursive:true, force:true});
      resolve({code, signal, out, ms: Date.now() - started});
    });
  });
}

const BAD = [
  ['abc', '«abc»'], ['0,abc', '«abc»'], ['-1', '«-1»'], [String(N), `«${N}»`], ['1.5', '«1.5»'],
  ['0,,1', 'пустой'], ['1,1', 'повтор'], [',', 'пустой'], ['', 'не задан'], [undefined, 'не задан']
];

for(const APP_ENV of ['dev', 'prod']){
  test(`${APP_ENV}: неверный BETA_OPEN — выход с кодом 1 и сообщением про BETA_OPEN`, async () => {
    const runs = await Promise.all(BAD.map(([raw]) => start(APP_ENV, raw)));
    BAD.forEach(([raw, detail], k) => {
      const {code, out, ms} = runs[k];
      const label = `BETA_OPEN=${JSON.stringify(raw)}`;
      assert.equal(code, 1, label);
      assert.match(out, /BETA_OPEN/, label);
      assert.ok(out.includes(detail), `${label}: ${out}`);
      assert.ok(out.includes(`0…${N - 1}`), `${label}: диапазон`);
      // до БД не дошли: ни ошибки соединения, ни общего сообщения про env
      assert.ok(!/ECONNREFUSED|postgres/i.test(out), `${label}: ${out}`);
      assert.ok(!out.includes('Invalid environment'), label);
      // значения других переменных в вывод не попадают
      assert.ok(!out.includes('synthetic-startup-token') && !out.includes('scratch_secret'), label);
      assert.ok(ms < 10_000, `${label}: ${ms} мс`);
    });
  });
}

test('корректный BETA_OPEN проходит проверку и доходит до подключения к БД', async () => {
  for(const APP_ENV of ['dev', 'prod']){
    const {code, out} = await start(APP_ENV, '0,1,3,4');
    assert.notEqual(code, 0, 'БД недостижима — процесс должен упасть уже на ней');
    assert.match(out, /ECONNREFUSED/);
    assert.ok(!out.includes('BETA_OPEN'), out);
    assert.ok(!out.includes('Invalid environment'), out);
  }
});
