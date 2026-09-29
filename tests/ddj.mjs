/* Стенд для пульта Pioneer DDJ-FLX4: разбор MIDI и заводские привязки.

     node tests/ddj.mjs

   Ядро ddj-core берётся прямо из noisefield.html, эталон — tests/ddj-flx4.txt:
   все сообщения MIDI-IN из официального «List of MIDI messages» Pioneer,
   снятые из PDF построчно. Каждое сообщение таблицы должно разобраться в тот
   орган, который в ней записан, и ни одна нота или CC ядра не должна быть
   выдумана — всё, что ядро слушает, есть в таблице. Плюс 14 бит, джоги,
   рычаг FX CH SELECT, дребезг и заводские привязки против SPEC.          */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, '..', 'noisefield.html'), 'utf8');

function block(name){
  const a = HTML.indexOf(`/* ==== ${name}:start`), b = HTML.indexOf(`/* ==== ${name}:end`);
  if (a < 0 || b < a) throw new Error('в noisefield.html не найден блок ' + name);
  return HTML.slice(a, b);
}
const C = new Function(block('ddj-core') + `
  return { DDJ_ABS, DDJ_DECK, DDJ_FX, DDJ_MIX, DDJ_MODE, DDJ_MODE_LED, DDJ_MAX,
           nfDdjDecoder, ddjUnit, ddjSteady, ddjMeter, ddjPad };`)();

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond){ fails++; console.log('  ✗ ' + msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hx = n => n.toString(16).toUpperCase().padStart(2, '0');

/* ---- эталон ---------------------------------------------------------- */
const rows = readFileSync(join(HERE, 'ddj-flx4.txt'), 'utf8').split('\n')
  .filter(l => l.trim() && !l.startsWith('#'))
  .map(l => { const [ui, deck, sh, cond, trig, st, d1, lsb] = l.split(' | ').map(s => s.trim());
              return { ui, deck: deck === '-' ? -1 : +deck - 1, sh: +sh, cond, trig,
                       st: parseInt(st, 16), d1: parseInt(d1, 16), lsb: lsb === '-' ? null : parseInt(lsb, 16) }; });

const ABS = { 'TEMPO':'tempo', 'TRIM':'trim', 'EQ HI':'hi', 'EQ MID':'mid', 'EQ LOW':'low', 'CFX':'cfx',
              'CH FADER':'ch', 'CROSSFADER':'xf', 'LEVEL/DEPTH':'depth', 'MASTER LEVEL':'master',
              'MIC LEVEL':'mic', 'HEADPHONE MIX':'phmix', 'HEADPHONE LEVEL':'phlvl' };
const BTN = { 'PLAY/PAUSE':'play', 'CUE':'cue', 'IN':'in', 'OUT':'out', '4 BEAT / EXIT':'exit',
              'CUE/LOOP CALL ◁':'back', 'CUE/LOOP CALL ▷':'fwd', 'BEAT SYNC':'sync', 'CH CUE':'chcue',
              'FX SELECT':'fxsel', 'BEAT ◁':'beatl', 'BEAT ▷':'beatr', 'FX ON/OFF':'fxon',
              'MASTER CUE':'mcue', 'SMART CFX':'scfx', 'SMART FADER':'sfade', 'Android MONO/STEREO':'mono' };
const MODES = ['HOT CUE MODE', 'PAD FX 1 MODE', 'BEAT JUMP MODE', 'SAMPLER MODE',
               'KEYBOARD MODE', 'PAD FX 2 MODE', 'BEAT LOOP MODE', 'KEY SHIFT MODE'];
const MODE_BTN = { 'HOT CUE MODE':0, 'PAD FX 1 MODE':1, 'BEAT JUMP MODE':2, 'SAMPLER MODE':3 };

// Чего ждать от строки таблицы. null — сообщение ядро сознательно пропускает.
function expect(r){
  const n = r.deck >= 0 ? String(r.deck + 1) : '';
  if (ABS[r.ui] && r.lsb != null) return { t:'abs', id: ABS[r.ui] + (['xf','depth','master','mic','phmix','phlvl'].includes(ABS[r.ui]) ? '' : n) };
  if (r.ui === 'CH FADER' || r.ui === 'CROSSFADER') return null;            // «старт фейдером» — ноты при SHIFT
  if (r.ui === 'BEAT SYNC' && r.trig === 'Long') return null;               // долгое нажатие — мимо
  if (r.ui === 'SHIFT') return { t:'shift', deck: r.deck, on: true };
  if (r.ui === 'JOG DIAL (Platter)' && r.trig === 'Touch') return { t:'touch', deck: r.deck, on: true };
  if (r.ui === 'JOG DIAL (Platter)') return { t:'rel', id:'jog', deck: r.deck, sh: r.sh, v: 1 };
  if (r.ui === 'JOG DIAL (Wheel side)') return { t:'rel', id:'side', deck: r.deck, sh: 0, v: 1 };  // SHIFT бок не меняет
  if (r.ui === 'BROWSE' && r.trig === 'Rotate') return { t:'rel', id:'browse', deck: -1, sh: r.sh, v: 1 };
  if (r.ui === 'BROWSE') return { t:'btn', id:'push', deck: -1, sh: r.sh, on: true };
  if (r.ui === 'LOAD') return { t:'btn', id:'load' + (r.deck + 1), deck: -1, sh: r.sh, on: true };
  if (MODE_BTN[r.ui] != null) return { t:'mode', deck: r.deck, mode: MODE_BTN[r.ui] + (r.sh ? 4 : 0), on: true };
  if (r.ui.startsWith('PERFORMANCE PAD'))
    return { t:'pad', deck: r.deck, sh: r.sh, mode: MODES.indexOf(r.cond), pad: +r.ui.slice(-1) - 1, on: true };
  if (r.ui === 'FX CH SELECT') return 'lever';
  if (BTN[r.ui]) return { t:'btn', id: BTN[r.ui], deck: r.deck, sh: r.sh, on: true };
  return 'unknown';
}

console.log('DDJ-FLX4 · разбор по официальной таблице (' + rows.length + ' сообщений)');
const MID = [0x40, 0x00];                 // 14 бит: ровно середина
for (const r of rows){
  const want = expect(r);
  const tag = r.ui + ' ' + (r.deck >= 0 ? 'дека ' + (r.deck + 1) + ' ' : '') + (r.sh ? '+SHIFT ' : '') +
              (r.cond !== '-' ? '[' + r.cond + '] ' : '') + hx(r.st) + ' ' + hx(r.d1);
  ok(want !== 'unknown', 'в стенде нет ожидания для «' + tag + '»');
  if (want === 'unknown' || want === 'lever') continue;
  const dec = C.nfDdjDecoder();
  let got;
  if (r.lsb != null){
    ok(dec([r.st, r.d1, MID[0]]) === null, tag + ': старший байт не должен давать события');
    got = dec([r.st, r.lsb, MID[1]]);
    if (want) want.v = 8192;
  } else if ((r.st & 0xF0) === 0xB0){
    got = dec([r.st, r.d1, r.ui === 'BROWSE' ? 0x01 : 0x41]);
  } else got = dec([r.st, r.d1, 0x7F]);
  ok(same(got, want), tag + ': ждали ' + JSON.stringify(want) + ', получили ' + JSON.stringify(got));
  // Кнопка отпущена — та же нота с нулём и настоящий note off тоже.
  if (want && (want.t === 'btn' || want.t === 'pad' || want.t === 'shift' || want.t === 'touch' || want.t === 'mode')){
    const d2 = C.nfDdjDecoder();
    ok(d2([r.st, r.d1, 0]).on === false, tag + ': скорость 0 — отпущена');
    ok(d2([r.st & 0x0F | 0x80, r.d1, 0x40]).on === false, tag + ': note off — отпущена');
  }
}

// Ни одного выдуманного сообщения: всё, что слушает ядро, есть в таблице.
const official = new Set(rows.flatMap(r => [r.st*128 + r.d1].concat(r.lsb != null ? [r.st*128 + r.lsb] : [])));
const heard = [];
for (const st in C.DDJ_ABS) for (const cc in C.DDJ_ABS[st]) heard.push([+st, +cc], [+st, +cc + 0x20]);
for (const ch of [0x90, 0x91]){
  for (const n in C.DDJ_DECK) heard.push([ch, +n]);
  for (const n in C.DDJ_MODE) heard.push([ch, +n]);
  heard.push([ch, 0x3F], [ch, 0x36], [ch, 0x67]);
}
for (const n in C.DDJ_FX) heard.push([0x94, +n]);
for (const n in C.DDJ_MIX) heard.push([0x96, +n]);
for (const [st, n] of heard) ok(official.has(st*128 + n), 'ядро слушает ' + hx(st) + ' ' + hx(n) + ', а в таблице такого нет');
// И обратно: ни одна кнопка или ручка таблицы не пропущена.
const got = rows.filter(r => { const w = expect(r); return w && w !== 'unknown'; }).length;
console.log('  разобрано ' + got + ' из ' + rows.length + ', сознательно мимо: ' +
            rows.filter(r => expect(r) === null).map(r => r.ui + (r.trig === 'Long' ? ' (долгое)' : ' (старт)')).length);

/* ---- рычаг FX CH SELECT ----------------------------------------------- */
console.log('рычаг FX CH SELECT');
for (const pos of ['CH1', 'CH2', 'CH1&CH2']){
  const dec = C.nfDdjDecoder();
  let last = null;
  for (const r of rows.filter(r => r.ui === 'FX CH SELECT' && r.cond === pos)){
    // Значение ноты в таблице — в описании положения: 7F у той, что включена.
    const on = (pos === 'CH1' && r.st === 0x94 && r.d1 === 0x10) || (pos === 'CH2' && r.st === 0x95 && r.d1 === 0x11) ||
               (pos === 'CH1&CH2' && ((r.st === 0x94 && r.d1 === 0x10) || (r.st === 0x95 && r.d1 === 0x11)));
    last = dec([r.st, r.d1, on ? 0x7F : 0]);
  }
  ok(last && last.t === 'lever' && last.pos === { 'CH1':1, 'CH2':2, 'CH1&CH2':3 }[pos], pos + ': положение ' + JSON.stringify(last));
}
{ // Пачка, снятая с живого пульта в ответ на запрос положений (рычаг в «1&2»).
  const dec = C.nfDdjDecoder(); let last = null;
  for (const [st, n, v] of [[0x94,0x10,0x7F],[0x94,0x11,0],[0x94,0x12,0],[0x94,0x13,0],[0x94,0x14,0],[0x94,0x15,0],
                            [0x95,0x10,0],[0x95,0x11,0x7F],[0x95,0x12,0],[0x95,0x13,0],[0x95,0x14,0],[0x95,0x15,0]])
    last = dec([st, n, v]);
  ok(last.pos === 3, 'пачка с живого пульта: «1&2», получили ' + last.pos);
}

/* ---- 14 бит, джоги, дребезг, индикатор -------------------------------- */
console.log('14 бит, джоги, дребезг, подсветка');
{
  const dec = C.nfDdjDecoder();
  ok(dec([0xB0, 0x2F, 0x10]) === null, 'младший байт без старшего — ждём целой пары');
  dec([0xB0, 0x0F, 0x7F]);
  ok(dec([0xB0, 0x2F, 0x7F]).v === C.DDJ_MAX, 'до упора — 16383');
  dec([0xB0, 0x0F, 0x00]);
  ok(dec([0xB0, 0x2F, 0x00]).v === 0, 'в ноль — 0');
  ok(C.ddjUnit(8192) === 0.5 && C.ddjUnit(0) === 0 && C.ddjUnit(C.DDJ_MAX) === 1, 'фиксатор — ровно середина, края — 0 и 1');
  ok(dec([0xB0, 0x22, 0x3F]).v === -1 && dec([0xB1, 0x21, 0x45]).v === 5, 'джог: вокруг 0x40');
  ok(dec([0xB6, 0x40, 0x7F]).v === -1 && dec([0xB6, 0x40, 0x02]).v === 2, 'BROWSE: дополнительный код');
  ok(dec([0xB0, 0x02, 0x40]) === null, 'CC 02 — это выход индикатора, не орган');
}
{
  const s = C.ddjSteady(24);
  // 1090 и 1080 — назад против хода на 10 и 20 от 1100: дребезг. 1070 — уже 30: рука,
  // ход теперь вниз. 1071 и 1080 — дребезг вверх против нового хода; 1100 — снова рука.
  const seq = [[1000, true], [1100, true], [1090, false], [1080, false], [1070, true], [1071, false],
               [1080, false], [1100, true], [1100, false]];
  for (const [v, want] of seq) ok(s('hi1', v) === want, 'дребезг: ' + v + ' → ' + want);
  ok(s('low1', 5000) && s('low1', 4990), 'у каждого органа свой ход');
  // К упору пропускаем и малый шаг назад: фейдер должен дойти до края.
  ok(s('ch1', 0) && s('ch1', 10) && s('ch1', 0), 'малый шаг назад к нулю — проходит');
  ok(s('ch2', 100) && s('ch2', 110) && !s('ch2', 100), 'тот же шаг не у края — дребезг');
  ok(s('xf', C.DDJ_MAX - 10) && s('xf', C.DDJ_MAX - 20) && s('xf', C.DDJ_MAX), 'малый шаг назад к максимуму — проходит');
}
ok(C.ddjMeter(0) === 0 && C.ddjMeter(0.2) === 0x26 && C.ddjMeter(1) === 0x77 && C.ddjMeter(2) === 0x77,
   'индикатор канала: ноль, первый зелёный, красный');
ok(same(C.ddjPad(0, 0, 0, 0), [0x97, 0x00]) && same(C.ddjPad(1, 1, 7, 7), [0x9A, 0x77]), 'адрес светодиода пэда');
ok(C.DDJ_MODE_LED.flat().every(n => C.DDJ_MODE[n] != null), 'кнопки режимов светятся своими нотами');

/* ---- заводские привязки ----------------------------------------------- */
console.log('заводские привязки');
{
  const spec = HTML.slice(HTML.indexOf('const SPEC = ['), HTML.indexOf('// Что трогает кнопка «рандом»'));
  const params = new Set([...spec.matchAll(/\[\s*'(\w+)',\s*'/g)].map(m => m[1]));
  const src = HTML.slice(HTML.indexOf('const DDJ = {'), HTML.indexOf('for (const id in DDJ_SHORT)'));
  const DDJ = new Function(src + 'return DDJ;')();
  const organs = Object.values(C.DDJ_ABS).flatMap(t => Object.values(t));
  const b = DDJ.binds, vals = Object.values(b);
  ok(organs.length === 20, 'органов с абсолютным ходом — 20, получили ' + organs.length);
  for (const id of organs){
    ok(b[id], id + ': нет привязки');
    ok(b[id + '^'], id + ' с SHIFT: нет привязки');
  }
  ok(Object.keys(b).length === 40, 'привязок 40, получили ' + Object.keys(b).length);
  ok(new Set(vals).size === vals.length, 'у каждого параметра один орган');
  for (const k of vals) ok(params.has(k), 'параметра «' + k + '» нет в SPEC');
  ok(DDJ.match.test('DDJ-FLX4') && DDJ.match.test('MIDIIN2 (DDJ-FLX4)') && !DDJ.match.test('Akai MPK49'),
     'имя порта: DDJ-FLX4 узнаётся, чужой — нет');
  console.log('  параметров под пультом: ' + vals.length + ' из ' + params.size + ' ползунков');
}

console.log(fails ? `\nПРОВАЛ: ${fails} из ${checks}` : `\nвсё сошлось: ${checks} проверок`);
process.exit(fails ? 1 : 0);
