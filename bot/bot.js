/* ============================================================
   RIZZOMA — бэкенд Mini App (бета).

   Что делает:
     1) /start — открывает приложение и связывает аккаунт с узлом;
     2) /api/visit  — фиксирует, по чьей ссылке открыто приложение;
     3) /api/state  — состояние узла: код, оплата, узлы, туман беты;
     4) /api/invoice — счёт на оплату (сумму считает сервер, не клиент);
     5) successful_payment — единственное место, где засчитывается узел;
     6) /api/friends — вкладка «Свои»;
     7) /api/admin/* — управление бетой, только для ADMIN_TG_IDS.

   Профиль и регистрация участника сохраняются через registration API.
   Счета, оплаты, баллы, betaOpen и отзыв доступа хранятся в PostgreSQL.
   Map ниже используется только в автономном режиме существующих тестов.
   ⚠ Telegram НЕ отдаёт адресную книгу ни боту, ни Mini App. Граф строится
     только из переходов по реферальным ссылкам.
   ============================================================ */
import 'dotenv/config';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { Bot, InlineKeyboard } from 'grammy';
import { PostgresBotStore } from './storage.js';

/* экономику берём из того же файла, что и фронт: цена считается по одним
   правилам на клиенте и на сервере, но решает всегда сервер */
const require = createRequire(import.meta.url);
const ECON = require('../economy.js');
const ENG  = require('../engagement.js');

const TOKEN      = process.env.BOT_TOKEN;
const APP_URL    = process.env.APP_URL;                       // https://…/index.html
const REGISTRATION_API_BASE = String(process.env.REGISTRATION_API_BASE || '').replace(/\/+$/, '');
const STORE      = process.env.DATABASE_URL ? new PostgresBotStore(process.env.DATABASE_URL) : null;
const PORT       = Number(process.env.PORT || 8080);
const ORIGIN     = process.env.CORS_ORIGIN || '*';
const MAX_AGE    = 24 * 60 * 60;                              // initData живёт сутки

/* Платежи. PROVIDER_TOKEN выдаёт @BotFather → /mybots → Payments
   (ЮKassa, Robokassa, CloudPayments — см. README). Тестовый токен
   провайдера содержит TEST и деньги не списывает. */
const PROVIDER_TOKEN = process.env.PROVIDER_TOKEN || '';
const CURRENCY  = process.env.CURRENCY || 'RUB';
const PRICES = {
  std: numOrNull(process.env.PRICE_STD),
  vip: numOrNull(process.env.PRICE_VIP)
};
const ADMINS = String(process.env.ADMIN_TG_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

/* Активность в канале. CHANNEL_ID — числовой id (не @username), узнаётся
   один раз через getChat. Без него баллы не начисляются вообще: иначе бот,
   которого позвали в любой чужой чат, начал бы там раздавать очки.
   DISCUSSION_ID — привязанная группа обсуждений, если она есть; пока её нет,
   комментарии просто не приходят и правило 'comment' не срабатывает. */
const CHANNEL_ID    = idOrNull(process.env.CHANNEL_ID);
const DISCUSSION_ID = idOrNull(process.env.DISCUSSION_ID);

/* Telegram не присылает эти типы по умолчанию — даже администратору.
   Их нужно назвать явно при старте, иначе обработчики ниже молча мертвы. */
const ALLOWED_UPDATES = [
  'message', 'callback_query', 'pre_checkout_query',
  'chat_member', 'message_reaction', 'chat_boost', 'removed_chat_boost'
];

function idOrNull(v){
  const n = Number(v);
  return (v === undefined || v === '' || !isFinite(n) || n === 0) ? null : n;
}
function numOrNull(v){
  const n = Number(v);
  return (v === undefined || v === '' || !isFinite(n) || n < 0) ? null : Math.round(n);
}
function parseList(v){
  if(!v) return null;
  const a = String(v).split(',').map(s => parseInt(s.trim(), 10)).filter(n => n >= 0 && n < ECON.TIERS.length);
  return a.length ? a : null;
}

if(!TOKEN || !APP_URL){
  console.error('Нужны BOT_TOKEN и APP_URL в .env — см. .env.example');
  process.exit(1);
}
if(!ADMINS.length) console.warn('ADMIN_TG_IDS пуст: бета-админка не откроется ни для кого');
if(!PROVIDER_TOKEN) console.warn('PROVIDER_TOKEN пуст: счета не выставляются, оплата недоступна');
if(!CHANNEL_ID) console.warn('CHANNEL_ID пуст: баллы за активность в канале не начисляются');
if(!REGISTRATION_API_BASE) console.warn('REGISTRATION_API_BASE пуст: PostgreSQL-регистрация отключена');

/* ---------- in-memory контур существующих тестов; production требует STORE ---------- */
const users = new Map();   // tgId -> {id,name,username,photo,code,invitedBy,paid,revoked,ts}
const codes = new Map();   // code -> tgId
const payments = [];       // журнал платежей теста (последние 200)
let betaOpen = parseList(process.env.BETA_OPEN) || ECON.BETA_OPEN.slice();

/* Баллы за канал живут отдельно от users: реакцию может поставить человек,
   который приложение ни разу не открывал. Заводить ему узел дерева и
   показывать его в воронке тестеров было бы враньём — связываются они
   по tgId в момент, когда он всё-таки зайдёт в приложение. */
const engagement = new Map();   // tgId -> {points, events:[…]} (ledger из engagement.js)

const ALPHA = 'ACDEFHJKLMNPRTUVWXY3479';
function newCode(){
  let c;
  do { c = ''; for(let i=0;i<6;i++) c += ALPHA[crypto.randomInt(ALPHA.length)]; }
  while(codes.has(c));
  return c;
}

const upsert = (tg, patch = {}) => {
  const id = String(tg.id);
  const cur = users.get(id) || {id, code:null, invitedBy:null, paid:false, revoked:false, ts:Date.now()};
  if(patch.code && cur.code && patch.code !== cur.code) codes.delete(cur.code);
  const next = Object.assign(cur, {
    name: [tg.first_name, tg.last_name].filter(Boolean).join(' ') || cur.name || 'Узел',
    username: tg.username || cur.username || '',
    photo: tg.photo_url || cur.photo || ''
  }, patch);
  // код узла выдаёт сервер, а не клиент: иначе его можно подобрать руками
  if(!next.code) next.code = newCode();
  users.set(id, next);
  codes.set(next.code, id);
  return next;
};

function normalizedTelegramUser(tg){
  return {
    id: String(tg.id),
    username: tg.username || null,
    firstName: tg.first_name,
    lastName: tg.last_name || null
  };
}

async function registerParticipant(tg, referralCode){
  if(!REGISTRATION_API_BASE) return null;
  const body = {telegramUser: normalizedTelegramUser(tg)};
  if(referralCode) body.referralCode = referralCode;
  const canonical = JSON.stringify({
    telegramUser: body.telegramUser,
    referralCode: body.referralCode || null
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', TOKEN)
    .update(`${timestamp}.${canonical}`)
    .digest('hex');
  const response = await fetch(`${REGISTRATION_API_BASE}/api/v1/registrations/bot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Rizzoma-Bot-Timestamp': timestamp,
      'X-Rizzoma-Bot-Signature': signature
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });
  if(!response.ok) throw new Error(`registration API returned ${response.status}`);
  return response.json();
}

async function participantFor(tg, referralCode){
  const registration = await registerParticipant(tg, referralCode);
  if(STORE){
    if(!registration) throw new Error('Registration API is required');
    const me = await STORE.snapshot(tg.id);
    if(!me || me.status !== 'active') throw new Error('Registered participant is unavailable');
    return {me, registration};
  }
  const saved = registration && registration.registration;
  const me = upsert(tg, saved ? {
    code: saved.referralCode,
    invitedBy: saved.referredByCode || null
  } : {});
  if(!registration && referralCode && !me.invitedBy && me.code !== referralCode){
    upsert(tg, {invitedBy: referralCode});
  }
  return {me, registration};
}

async function participantForRequest(req, res, tg, referralCode){
  try {
    return await participantFor(tg, referralCode);
  } catch(error) {
    console.error('participant registration failed:', error.message);
    res.status(503).json({error:'registration unavailable'});
    return null;
  }
}

/* Узлы ветви = те, кто пришёл по ссылке И оплатил. Считается из графа,
   отдельного счётчика нет — поэтому накрутить его нечем. */
const refsOf = u => u && Number.isInteger(u.refs)
  ? u.refs : [...users.values()].filter(x => x.invitedBy === u.code && x.paid).length;

/* ---------- валидация initData (HMAC «WebAppData») ---------- */
function validateInitData(initData){
  if(typeof initData !== 'string' || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  // строгий формат обязателен: Buffer.from(hex) молча обрезает строку на
  // первом невалидном символе, и подпись с мусором на хвосте прошла бы сравнение
  if(!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(calc, 'hex'), b = Buffer.from(hash, 'hex');
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if(!authDate || Date.now()/1000 - authDate > MAX_AGE) return null;

  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

/* ============================ БОТ ============================ */
const bot = new Bot(TOKEN);

const openKeyboard = () => new InlineKeyboard().webApp('Открыть RIZZOMA', APP_URL);

bot.command('start', async ctx => {
  const payload = (ctx.match || '').trim();
  const tg = ctx.from;

  const referral = /^[A-Z0-9]{4,8}$/i.test(payload) ? payload.toUpperCase() : '';
  let participant;
  try {
    participant = await participantFor(tg, referral);
  } catch(error) {
    console.error('participant registration failed:', error.message);
    await ctx.reply('Регистрация временно недоступна. Попробуй ещё раз через минуту.');
    return;
  }
  const {me, registration} = participant;

  if(payload.startsWith('link_')){
    // привязка аккаунта к уже активированному узлу
    const code = payload.slice(5).toUpperCase().slice(0, 8);
    // При подключённой PostgreSQL код выдаёт registration API. Старую
    // привязку к клиентскому коду сохраняем только в автономном legacy-режиме.
    if(!registration && code && code !== me.code){ codes.delete(me.code); upsert(tg, {code}); }
    await ctx.reply(
      `Узел ${registration ? me.code : (code || me.code)} привязан.\nВо вкладке «Свои» видно, кто пришёл по твоей ссылке.`,
      { reply_markup: openKeyboard() }
    );
    return;
  }

  await ctx.reply(
    'RIZZOMA. Билеты и реферальная сеть.\nПозвал — друг оплатил — тебе узел.',
    { reply_markup: openKeyboard() }
  );
});

/* ---------- платежи ----------
   pre_checkout подтверждаем только если сумма всё ещё сходится с тем,
   что сервер посчитал бы сейчас: цена в payload клиенту не принадлежит. */
bot.on('pre_checkout_query', async ctx => {
  const q = ctx.preCheckoutQuery;
  try {
    const p = JSON.parse(q.invoice_payload || '{}');
    if(STORE){
      const intent = await STORE.invoiceForCheckout(p.invoiceId, q.from.id);
      const ok = !!intent && Number(intent.amount_minor) === q.total_amount && intent.currency === q.currency;
      await ctx.answerPreCheckoutQuery(ok, ok ? undefined : 'Счёт устарел, откройте приложение заново');
      return;
    }
    const u = users.get(String(q.from.id));
    const want = amountFor(u, p.cls, p.size);
    const ok = !!u && !u.revoked && want !== null && want === q.total_amount;
    await ctx.answerPreCheckoutQuery(ok, ok ? undefined : 'Счёт устарел, откройте приложение заново');
  } catch(e){
    await ctx.answerPreCheckoutQuery(false, 'Счёт не распознан');
  }
});

/* Единственное место, где засчитывается оплата и узел приглашавшему.
   Клиент об оплате не сообщает вообще — ему просто нечему верить. */
bot.on('message:successful_payment', async ctx => {
  const sp = ctx.message.successful_payment;
  let payload = {};
  try { payload = JSON.parse(sp.invoice_payload || '{}'); } catch(e){}
  let u;
  let ticket = payload;
  if(STORE){
    const receipt = await STORE.recordPayment(ctx.from.id, payload.invoiceId, sp);
    if(!receipt.created) return; // Telegram доставил уже учтённую оплату ещё раз.
    u = receipt.user;
    ticket = receipt;
  } else {
    u = upsert(ctx.from, { paid: true });
    if(!u.invitedBy && payload.ref && payload.ref !== u.code) upsert(ctx.from, { invitedBy: payload.ref });
    payments.unshift({
      ts: Date.now(), id: u.id, name: u.name, username: u.username,
      amount: sp.total_amount, currency: sp.currency,
      cls: payload.cls || '—', size: payload.size || '—',
      status: 'paid', charge: sp.provider_payment_charge_id || ''
    });
    if(payments.length > 200) payments.pop();
  }

  const size = ECON.sizeOf(ticket.size) || ECON.TICKET_SIZE[0];
  const cls  = ECON.classOf(ticket.cls) || ECON.TICKET_CLASS[0];
  await ctx.reply(
    `Оплачено. ${size.name} · ${cls.name}.\n` +
    `Входов: ${size.qty}. Узел: ${u.code}.\n` +
    `Билет показать на входе вместе с паспортом (18+).`,
    { reply_markup: openKeyboard() }
  );
  const inviter = STORE ? await STORE.inviterFor(ctx.from.id)
    : u.invitedBy && users.get(codes.get(u.invitedBy));
  if(inviter){
    try {
      await bot.api.sendMessage(inviter.id,
        `+1 узел. Теперь их ${refsOf(inviter)}.`, { reply_markup: openKeyboard() });
    } catch(e){}
  }
});

/* ==================== АКТИВНОСТЬ В КАНАЛЕ ====================
   Ловим только то, что Telegram действительно отдаёт боту-администратору:
   подписку, реакцию на пост и буст канала (плюс комментарий, если к каналу
   когда-нибудь привяжут группу обсуждений). Просмотры, пересылки и история
   до момента, когда бота сделали админом, Bot API не отдаёт никому — их
   здесь нет и не появится.
   Всю арифметику делает engagement.js, здесь только фильтры и хранение.
   ============================================================ */
const isChannel    = id => CHANNEL_ID    !== null && Number(id) === CHANNEL_ID;
const isDiscussion = id => DISCUSSION_ID !== null && Number(id) === DISCUSSION_ID;

/* id того, кому вообще можно что-то начислить: боты мимо, анонимная реакция
   от лица канала приходит без user — привязывать её не к кому */
function payee(user){
  if(!user || user.is_bot) return null;
  const id = String(user.id || '');
  return /^\d+$/.test(id) ? id : null;
}
async function engAward(user, rule, subject){
  const id = payee(user);
  if(!id) return null;
  if(STORE){
    const result = await STORE.engagementChange(id, rule, subject, 'award');
    if(result.ok) console.log(`+${result.points} ${rule}`);
    return result;
  }
  const res = ENG.award(engagement.get(id) || ENG.emptyLedger(), {rule, userId: id, subject});
  if(!res.ok) return null;
  engagement.set(id, res.ledger);
  console.log(`+${res.event.points} ${rule} → ${id} (итого ${res.ledger.points})`);
  return res;
}
async function engRevoke(user, rule, subject){
  const id = payee(user);
  if(!id) return null;
  if(STORE){
    const result = await STORE.engagementChange(id, rule, subject, 'revoke');
    if(result.ok) console.log(`−${result.points} ${rule}`);
    return result;
  }
  const res = ENG.revoke(engagement.get(id) || ENG.emptyLedger(), {rule, userId: id, subject});
  if(!res.ok) return null;
  engagement.set(id, res.ledger);
  console.log(`−${res.points} ${rule} → ${id} (итого ${res.ledger.points})`);
  return res;
}
const engagementOf = id => engagement.get(String(id)) || ENG.emptyLedger();

/* подписка на канал: статус сменился на «в чате» из «не в чате».
   Начисляем тому, чей статус изменился, а не тому, кто изменил. */
bot.on('chat_member', async ctx => {
  const upd = ctx.chatMember;
  if(!isChannel(upd.chat.id)) return;
  const was = upd.old_chat_member.status, now = upd.new_chat_member.status;
  const out = s => s === 'left' || s === 'kicked';
  const inside = s => s === 'member' || s === 'administrator' || s === 'creator';
  if(out(was) && inside(now)) await engAward(upd.new_chat_member.user, 'join');
});

/* реакция на пост. Анонимная реакция от лица канала приходит без user —
   привязать её не к кому, просто пропускаем. */
bot.on('message_reaction', async ctx => {
  const r = ctx.messageReaction;
  if(!isChannel(r.chat.id)) return;
  if(!r.new_reaction || !r.new_reaction.length) return;     // реакцию сняли — не платим и не отнимаем
  await engAward(r.user, 'reaction', r.message_id);
});

bot.on('chat_boost', async ctx => {
  const b = ctx.chatBoost;
  if(!isChannel(b.chat.id)) return;
  await engAward(b.boost.source && b.boost.source.user, 'boost', b.boost.boost_id);
});
bot.on('removed_chat_boost', async ctx => {
  const b = ctx.removedChatBoost;
  if(!isChannel(b.chat.id)) return;
  await engRevoke(b.source && b.source.user, 'boost', b.boost_id);
});

/* комментарий в привязанной группе обсуждений. Пока DISCUSSION_ID не задан,
   этот обработчик не срабатывает ни разу. Автопересылка поста из канала
   приходит сюда же — она не от человека, её отсекает sender_chat. */
bot.on('message', async ctx => {
  const m = ctx.message;
  if(!isDiscussion(m.chat.id)) return;
  if(m.sender_chat || m.is_automatic_forward) return;
  await engAward(ctx.from, 'comment', m.message_id);
});

bot.catch(err => {
  console.error('bot update failed:', err instanceof Error ? err.name : 'UnknownError');
  // In production a failed payment/engagement write must not be treated as a
  // successful update and followed by more polling on a broken database.
  if(STORE) process.exit(1);
});

/* ============================ API ============================ */
const app = express();
app.use(express.json({ limit: '64kb' }));
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', ORIGIN);
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if(req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const auth = (req, res) => {
  const tg = validateInitData(req.body && req.body.initData);
  if(!tg){ res.status(401).json({ error: 'bad initData' }); return null; }
  return tg;
};
/* админка беты: та же проверка подписи + явный список id.
   Клиентские трюки (?admin=1, пять тапов) сюда не пускают. */
const adminAuth = (req, res) => {
  const tg = auth(req, res); if(!tg) return null;
  if(ADMINS.indexOf(String(tg.id)) < 0){ res.status(403).json({ error: 'forbidden' }); return null; }
  return tg;
};

/* сумма счёта в копейках — считается только здесь, из серверных данных */
function amountFor(u, clsId, sizeId){
  if(!u) return null;
  if(!ECON.classOf(clsId) || !ECON.sizeOf(sizeId)) return null;
  const refs = refsOf(u);
  const rub = ECON.comboPrice(clsId, sizeId, refs, {
    prices: PRICES,
    // VIP без наценки даёт скилл ГЛУБИНА: сервер проверяет не «claim»,
    // а само условие скилла — число оплативших приглашённых
    vipSkill: refs >= ECON.TIERS[ECON.VIP_TIER].n
  });
  if(rub === null) return null;
  return Math.round(rub * 100);
}

/* Mini App сообщает, по чьей ссылке открылась (startapp до бота не долетает). */
app.post('/api/visit', asyncRoute(async (req, res) => {
  const tg = auth(req, res); if(!tg) return;
  const ref = String(req.body.ref || '').toUpperCase().slice(0, 8);
  const participant = await participantForRequest(req, res, tg, /^[A-Z0-9]{4,8}$/.test(ref) ? ref : '');
  if(!participant) return;
  res.json({ ok: true, registration: participant.registration && participant.registration.registration });
}));

/* Состояние узла. Для приложения это источник правды: локальные данные —
   кэш на случай офлайна. */
app.post('/api/state', asyncRoute(async (req, res) => {
  const tg = auth(req, res); if(!tg) return;
  const participant = await participantForRequest(req, res, tg, '');
  if(!participant) return;
  const u = participant.me;
  res.json({
    code: u.code, paid: !!u.paid, revoked: !!u.revoked,
    refs: refsOf(u), invitedBy: u.invitedBy || null,
    betaOpen: STORE ? await STORE.beta(betaOpen) : betaOpen,
    prices: PRICES, currency: CURRENCY,
    payments: PROVIDER_TOKEN ? 'on' : 'off'
  });
}));

/* Баллы за активность в канале. Отдаём только свои: чужой ledger по этому
   эндпоинту не достать, id берётся из подписанной initData, а не из тела.
   tracking:'off' — бот не знает канала (CHANNEL_ID пуст), клиенту нужно
   сказать это честно, а не показывать ноль как достижение. */
app.post('/api/engagement', asyncRoute(async (req, res) => {
  const tg = auth(req, res); if(!tg) return;
  const led = STORE ? await STORE.engagement(tg.id) : engagementOf(tg.id);
  res.json({
    points: led.points,
    events: STORE ? led.events : led.events.slice(-20).reverse(),
    tracking: CHANNEL_ID ? 'on' : 'off',
    discussion: DISCUSSION_ID ? 'on' : 'off'
  });
}));

/* Счёт на оплату. Клиент присылает только состав и класс — сумму,
   скидку и валюту определяет сервер. */
app.post('/api/invoice', asyncRoute(async (req, res) => {
  const tg = auth(req, res); if(!tg) return;
  const ref = String(req.body.ref || '').toUpperCase().slice(0, 8);
  const participant = await participantForRequest(req, res, tg, /^[A-Z0-9]{4,8}$/.test(ref) ? ref : '');
  if(!participant) return;
  const u = participant.me;
  if(u.revoked) return res.status(403).json({ error: 'доступ к бете отозван' });
  if(!PROVIDER_TOKEN) return res.status(503).json({ error: 'платежи не подключены' });

  const cls = String(req.body.cls || ''), size = String(req.body.size || '');
  if(!ECON.classOf(cls) || !ECON.sizeOf(size)) return res.status(400).json({ error: 'неизвестный тариф' });
  const amount = amountFor(u, cls, size);
  if(amount === null) return res.status(400).json({ error: 'цена не объявлена' });
  if(amount <= 0)     return res.status(400).json({ error: 'к оплате 0 — билет уже бесплатный' });

  const c = ECON.classOf(cls), s = ECON.sizeOf(size);
  let invoiceId = null;
  if(STORE){
    try {
      invoiceId = await STORE.createInvoice(u.id, {amount, currency:CURRENCY, cls, size});
    } catch(error) {
      console.error('invoice persistence failed:', error instanceof Error ? error.name : 'UnknownError');
      return res.status(503).json({error:'хранилище счёта недоступно'});
    }
  }
  try {
    const link = await bot.api.createInvoiceLink(
      `${s.name} · ${c.name}`,
      `RIZZOMA · входов: ${s.qty} · узел ${u.code}`,
      STORE ? JSON.stringify({invoiceId})
        : JSON.stringify({cls, size, ref: u.invitedBy || ref || '', code: u.code}),
      PROVIDER_TOKEN,
      CURRENCY,
      [{ label: `${s.name} · ${c.name}`, amount }]
    );
    if(!STORE){
      payments.unshift({ ts: Date.now(), id: u.id, name: u.name, username: u.username,
                         amount, currency: CURRENCY, cls, size, status: 'invoice' });
      if(payments.length > 200) payments.pop();
    }
    res.json({ link, amount, currency: CURRENCY });
  } catch(e){
    if(STORE && invoiceId) await STORE.failInvoice(invoiceId).catch(() => undefined);
    console.error('invoice error:', e.message);
    res.status(502).json({ error: 'провайдер не принял счёт' });
  }
}));

/* Оставлено для совместимости с прежним контрактом: раньше сюда стучал
   клиент после мок-оплаты. Теперь оплату подтверждает только Telegram update
   successful_payment, поэтому здесь можно лишь привязать код узла. */
app.post('/api/purchase', asyncRoute(async (req, res) => {
  const tg = auth(req, res); if(!tg) return;
  const participant = await participantForRequest(req, res, tg, '');
  if(!participant) return;
  const u = participant.me;
  res.json({ ok: true, paid: !!u.paid, note: 'оплата засчитывается только Telegram successful_payment' });
}));

/* Вкладка «Свои»: ветвь + пригласивший + соседи по ветви. */
app.post('/api/friends', asyncRoute(async (req, res) => {
  const tg = auth(req, res); if(!tg) return;
  const participant = await participantForRequest(req, res, tg, '');
  if(!participant) return;
  const me = participant.me;
  if(STORE){
    return res.json({linked:!!me.code, friends:await STORE.friends(me.id)});
  }
  const all = [...users.values()];
  const out = new Map();

  const push = (u, status) => {
    if(!u || u.id === me.id || out.has(u.id)) return;
    out.set(u.id, {
      id: u.id, name: u.name, username: u.username, photo: u.photo,
      status, tier: 0
    });
  };

  if(me.code) all.filter(u => u.invitedBy === me.code).forEach(u => push(u, u.paid ? 'paid' : 'node'));
  if(me.invitedBy){
    push(users.get(codes.get(me.invitedBy)), 'paid');                       // кто позвал
    all.filter(u => u.invitedBy === me.invitedBy).forEach(u => push(u, u.paid ? 'paid' : 'node')); // соседи
  }

  res.json({ linked: !!me.code, friends: [...out.values()] });
}));

/* ======================= АДМИНКА БЕТЫ ======================= */

/* Воронка тестеров + журнал платежей + текущий туман. */
app.post('/api/admin/overview', asyncRoute(async (req, res) => {
  const tg = adminAuth(req, res); if(!tg) return;
  if(STORE) return res.json({ok:true, ...await STORE.overview(betaOpen)});
  const testers = [...users.values()]
    .sort((a, b) => b.ts - a.ts)
    .map(u => ({
      id: u.id, name: u.name, username: u.username,
      code: u.code, paid: !!u.paid, revoked: !!u.revoked,
      refs: refsOf(u), invitedBy: u.invitedBy || null, ts: u.ts
    }));
  res.json({
    ok: true, betaOpen, testers, payments: payments.slice(0, 50),
    totals: {
      testers: testers.length,
      paid: testers.filter(t => t.paid).length,
      revoked: testers.filter(t => t.revoked).length
    }
  });
}));

/* Туман на лету: какие узлы видит вся бета. Без деплоя. */
app.post('/api/admin/beta', asyncRoute(async (req, res) => {
  const tg = adminAuth(req, res); if(!tg) return;
  const list = Array.isArray(req.body.betaOpen) ? req.body.betaOpen : null;
  if(!list) return res.status(400).json({ error: 'betaOpen: нужен массив индексов' });
  const clean = [...new Set(list.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < ECON.TIERS.length))];
  const nextOpen = clean.sort((a, b) => a - b);
  betaOpen = STORE ? await STORE.setBeta(nextOpen, tg.id) : nextOpen;
  res.json({ ok: true, betaOpen });
}));

/* Отзыв доступа тестера: счёт ему больше не выставляется. */
app.post('/api/admin/tester', asyncRoute(async (req, res) => {
  const tg = adminAuth(req, res); if(!tg) return;
  const id = String(req.body.id || '');
  if(!/^\d+$/.test(id) || !['revoke', 'restore'].includes(req.body.action))
    return res.status(400).json({error:'неверный пользователь или действие'});
  if(STORE){
    const revoked = req.body.action === 'revoke';
    const found = await STORE.setRevoked(id, revoked);
    if(!found) return res.status(404).json({error:'нет такого тестера'});
    return res.json({ok:true, id, revoked});
  }
  const u = users.get(id);
  if(!u) return res.status(404).json({ error: 'нет такого тестера' });
  u.revoked = req.body.action === 'revoke';
  res.json({ ok: true, id, revoked: u.revoked });
}));

app.get('/health', asyncRoute(async (_, res) => {
  const counts = STORE ? await STORE.health() : {
    users: users.size, payments: payments.length, engaged: engagement.size
  };
  res.json({
    ok: true, ...counts,
    provider: PROVIDER_TOKEN ? 'on' : 'off', admins: ADMINS.length,
    channel: CHANNEL_ID ? 'on' : 'off'
  });
}));

app.use((error, _req, res, _next) => {
  console.error('bot request failed:', error instanceof Error ? error.name : 'UnknownError');
  if(!res.headersSent) res.status(503).json({error:'service unavailable'});
});

/* Поднимаем сеть только когда файл запущен напрямую. Автотесты импортируют
   этот модуль, чтобы скормить боту синтетические апдейты — им ни порт,
   ни long polling не нужны. */
const isEntry = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if(isEntry){
  if(!REGISTRATION_API_BASE || !STORE){
    console.error('Нужны REGISTRATION_API_BASE и DATABASE_URL: без PostgreSQL бот не запускается');
    process.exit(1);
  }
  await STORE.ready();
  await STORE.beta(betaOpen);
  app.listen(PORT, () => console.log(`API на :${PORT}`));
  /* Ошибка long polling останавливает процесс: оркестратор перезапустит его. */
  bot.start({ allowed_updates: ALLOWED_UPDATES })
     .catch(err => {
       console.error('бот не запустился (проверь BOT_TOKEN):', err.message);
       process.exitCode = 1;
       process.exit(1);
     });
}

export { bot, app, ALLOWED_UPDATES, engagementOf, users, upsert };
