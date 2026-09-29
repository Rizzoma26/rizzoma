/* Бета после переноса в конфигурацию контура: /api/state отдаёт список
   серверного модуля (BETA_OPEN), записи беты через API больше нет.
   Настоящий bot/bot.js, заглушка только у внутреннего сервиса идентичности —
   ни БД, ни Telegram. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac} from 'node:crypto';

const token = '12345:synthetic-beta-api-test-token';
function signed(id = 42, key = token) {
  const p = new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Test'})});
  const secret = createHmac('sha256','WebAppData').update(key).digest();
  p.set('hash',createHmac('sha256',secret).update([...p].map(([k,v])=>`${k}=${v}`).sort().join('\n')).digest('hex'));
  return p.toString();
}
async function listen(server) {
  server.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  return 'http://127.0.0.1:'+server.address().port;
}
const close = server => new Promise(resolve=>server.close(resolve));

/* Сервис идентичности: сессия по cookie и регистрация участника ботом. */
function identityStub() {
  return http.createServer((req,res)=>{
    const json = body => res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(body));
    if(req.url === '/api/v1/registrations/bot' && req.method === 'POST')
      return json({registration:{referralCode:'BETA42', referredByCode:null}});
    if(req.headers.cookie !== 'session=valid') return res.writeHead(401).end();
    const id = req.headers['x-test-user'] || '42';
    json({userId:'u'+id, telegramUserId:id});
  });
}

let loads = 0;
/* Каждый импорт с новым суффиксом — отдельный экземпляр модуля: env читается
   при импорте, как при запуске процесса с этим окружением. */
async function botWith(env) {
  Object.assign(process.env, {
    BOT_TOKEN:token, APP_URL:'https://app.invalid', CORS_ORIGIN:'https://app.invalid',
    DATABASE_URL:'', DEV_ALLOWED_TG_IDS:'42,43', ADMIN_TG_IDS:'42', PAYMENT_MODE:'disabled',
    CHANNEL_ID:'', DISCUSSION_ID:'', TELEGRAM_AUTH_MAX_AGE_SECONDS:'300'
  }, env);
  const {app} = await import('../bot/bot.js?beta-api=' + (++loads));
  const server = http.createServer(app);
  const api = await listen(server);
  const post = (path, id = 42, body = {}) => fetch(api + path, {
    method:'POST',
    headers:{'content-type':'application/json', cookie:'session=valid', origin:'https://app.invalid', 'x-test-user':String(id)},
    body:JSON.stringify({initData:signed(id), ...body})
  });
  return {post, close:() => close(server)};
}

test('/api/state отдаёт список контура из BETA_OPEN — в dev и в prod', async () => {
  const identity = identityStub();
  const base = await listen(identity);
  try {
    for(const [APP_ENV, raw, want] of [
      ['dev', '0,1,3,4', [0,1,3,4]], ['prod', '0,1,3,4', [0,1,3,4]],
      ['dev', ' 4, 2 ', [2,4]],      ['prod', '9', [9]]
    ]) {
      const bot = await botWith({APP_ENV, QA_ENABLED:APP_ENV === 'dev' ? 'true' : 'false',
        REGISTRATION_API_BASE:base, BETA_OPEN:raw});
      try {
        const r = await bot.post('/api/state');
        assert.equal(r.status, 200, `${APP_ENV} ${raw}`);
        assert.deepEqual((await r.json()).betaOpen, want, `${APP_ENV} ${raw}`);
      } finally { await bot.close(); }
    }
  } finally { await close(identity); }
});

test('записи беты через API нет: POST /api/admin/beta — 404 для админа и тестера', async () => {
  const identity = identityStub();
  const base = await listen(identity);
  try {
    for(const APP_ENV of ['dev', 'prod']) {
      const bot = await botWith({APP_ENV, QA_ENABLED:APP_ENV === 'dev' ? 'true' : 'false',
        REGISTRATION_API_BASE:base, BETA_OPEN:'0,1,3,4'});
      try {
        for(const id of [42, 43]) {
          const r = await bot.post('/api/admin/beta', id, {betaOpen:[0,1,2,3,4,5,6,7,8,9]});
          assert.equal(r.status, 404, `${APP_ENV} id=${id}`);
        }
        // попытка записи ничего не поменяла
        assert.deepEqual((await (await bot.post('/api/state')).json()).betaOpen, [0,1,3,4]);
        if(APP_ENV === 'dev') {
          const overview = await bot.post('/api/admin/overview');
          assert.equal(overview.status, 200);
          assert.deepEqual((await overview.json()).betaOpen, [0,1,3,4]);
        }
      } finally { await bot.close(); }
    }
  } finally { await close(identity); }
});

test('локальный режим без контура (без APP_ENV) берёт значение economy.js', async () => {
  const bot = await botWith({APP_ENV:'', QA_ENABLED:'false', REGISTRATION_API_BASE:'', BETA_OPEN:''});
  try {
    const r = await bot.post('/api/state');
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).betaOpen, [0,1,3,4]);
  } finally { await bot.close(); }
});
