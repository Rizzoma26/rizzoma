/* Измерительный стенд для детектора ударов.

     node tests/eval.mjs             сводная таблица: было / стало
     node tests/eval.mjs --t0        калибровка систематического сдвига
     node tests/eval.mjs --odf       распределение функции начала по сценам
     node tests/eval.mjs --sweep     перебор параметров ядра
     node tests/eval.mjs --look      цена упреждения для живого входа

   Ядро берётся прямо из noisefield.html (блок dsp-core) — не копия, а тот
   самый код, что работает в браузере. Материал — tests/synth.mjs.

   Колонки:
     F1        по всем перкуссионным событиям, допуск ±50 мс (как в MIREX);
     доли      какая часть долей сетки получила вспышку — то самое
               «попадает в бит»;
     сильн     какая часть долей покрыта СИЛЬНЫМИ вспышками (берём столько
               самых сильных срабатываний, сколько в сцене долей): картинке
               важно не только сработать, но и ударить там, где надо;
     сдвиг     систематическая ошибка времени на долях, мс, «+» — позже;
     разбр     разброс той же ошибки, мс: дрожание;
     /с        сколько срабатываний в секунду — в эмбиенте должно быть ~0;
     вспышка   через сколько после удара реально вспыхнет экран.            */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scenes, clicks, SR } from './synth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, '..', 'noisefield.html'), 'utf8');

// Ядро достаётся текстом. Перебор параметров подменяет константы прямо в
// исходнике — так в самом noisefield.html не заводится ни одной ручки,
// существующей только ради тестов.
function core(sub){
  const a = HTML.indexOf('/* ==== dsp-core:start');
  const b = HTML.indexOf('/* ==== dsp-core:end');
  if (a < 0 || b < a) throw new Error('в noisefield.html не найден блок dsp-core');
  let src = HTML.slice(a, b);
  for (const [k, v] of Object.entries(sub || {})){
    const re = new RegExp('const\\s+' + k + '\\s*=\\s*[^;]+;');
    if (!re.test(src)) throw new Error('нечего подменять: ' + k);
    src = src.replace(re, 'const ' + k + ' = ' + v + ';');
  }
  return new Function(src + `
    return { nfFFT, nfBands, nfOdfState, nfOdfStep, NfPicker, NF_T0, NF_GAMMA, NF_LOWB,
             nfOnsetTime, nfPct, nfStrength, NF_SREF, NF_CAP };`)();
}
const C = core();

const HOP = 512, WIN = 1024, BINS = 32, LO = 40, HI = 16000;

/* --------------------------------------------------- общий фронт-энд ----- */
// Полосы считаются один раз на сцену: старый алгоритм и новый смотрят на
// ровно одни и те же числа, иначе сравнение ничего не стоит.
function stft(x, sr){
  const frames = Math.max(1, Math.floor((x.length - WIN)/HOP));
  const fft = C.nfFFT(WIN), rng = C.nfBands(sr, WIN, BINS, LO, HI);
  const re = new Float32Array(WIN), im = new Float32Array(WIN);
  const han = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) han[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(WIN-1));
  const mag = new Float32Array(frames*BINS);
  for (let n = 0; n < frames; n++){
    const off = n*HOP;
    for (let i = 0; i < WIN; i++){ re[i] = x[off+i]*han[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < BINS; k++){
      const [a, b] = rng[k];
      let s = 0;
      for (let i = a; i <= b; i++) s += Math.sqrt(re[i]*re[i] + im[i]*im[i]);
      mag[n*BINS + k] = s/(b - a + 1)*4/WIN;
    }
  }
  return { mag, frames, dur: x.length/sr };
}

/* ------------------------------------------------------ старый алгоритм -- */
// Дословно то, что было в noisefield.html до переделки.
function oldFlux({ mag, frames }){
  const flux = new Float32Array(frames), prev = new Float32Array(BINS);
  for (let n = 0; n < frames; n++){
    let fx = 0;
    for (let k = 0; k < BINS; k++){
      const v = mag[n*BINS + k];
      if (k < 10){ const d = v - prev[k]; if (d > 0) fx += d; }
      prev[k] = v;
    }
    flux[n] = fx;
  }
  return flux;
}
function oldOffline(st, sr){
  const flux = oldFlux(st), frames = st.frames, W = 24, GAP = Math.round(0.10*sr/HOP);
  let fmax = 0; for (let n = 0; n < frames; n++) if (flux[n] > fmax) fmax = flux[n];
  const scale = fmax > 0 ? 1/fmax : 1;
  const out = []; let lastN = -1e9;
  for (let n = 1; n < frames-1; n++){
    const v = flux[n]*scale;
    let mean = 0, cnt = 0;
    for (let i = Math.max(0, n-W); i <= Math.min(frames-1, n+W); i++){ mean += flux[i]*scale; cnt++; }
    mean /= cnt;
    let dev = 0;
    for (let i = Math.max(0, n-W); i <= Math.min(frames-1, n+W); i++) dev += Math.abs(flux[i]*scale - mean);
    dev /= cnt;
    const thr = mean + dev*1.6 + 0.012;
    if (v > thr && v >= flux[n-1]*scale && v > flux[n+1]*scale && n - lastN >= GAP){
      lastN = n;
      const t = n*HOP/sr;
      out.push({ t, emit: t, s: v - thr });
    }
  }
  return norm(out);
}
function oldLive(st, sr, wf){
  const flux = oldFlux(st), frames = st.frames, WB = 24, CAL = 1720;
  const GAP = Math.max(4, Math.round(0.10*sr/HOP));
  const out = []; let lastN = -1e9;
  for (let n = 1; n < frames - wf - 1; n++){
    const from = Math.max(0, n - CAL);
    const p = C.nfPct(flux.slice(from, n + 1), 0.97);
    const scale = p > 1e-9 ? 1/p : 1;
    if (n - lastN < GAP) continue;
    const at = i => flux[Math.max(0, Math.min(frames-1, i))]*scale;
    const lo = Math.max(0, n - WB), hi = n + wf;
    let mean = 0, cnt = 0;
    for (let i = lo; i <= hi; i++){ mean += at(i); cnt++; }
    mean /= cnt;
    let dev = 0;
    for (let i = lo; i <= hi; i++) dev += Math.abs(at(i) - mean);
    dev /= cnt;
    const v = at(n), thr = mean + dev*1.6 + 0.012;
    if (v > thr && v >= at(n-1) && (wf < 1 || v > at(n+1))){
      lastN = n;
      out.push({ t: n*HOP/sr, emit: ((n + wf)*HOP + WIN)/sr, s: v - thr });
    }
  }
  return norm(out);
}

/* -------------------------------------------------------- новый алгоритм -- */
function newOdf(st, K){
  const s = K.nfOdfState(BINS), all = new Float32Array(st.frames), low = new Float32Array(st.frames);
  const m = new Float32Array(BINS);
  for (let n = 0; n < st.frames; n++){
    for (let k = 0; k < BINS; k++) m[k] = st.mag[n*BINS + k];
    const r = K.nfOdfStep(s, m, BINS);
    all[n] = r.all; low[n] = r.low;
  }
  return { all, low };
}
function newRun(st, sr, opt, K){
  K = K || C;
  const { all, low } = newOdf(st, K);
  const p = new K.NfPicker(opt);
  const out = [];
  for (let n = 0; n < st.frames; n++){
    const hit = p.push(all[n], low[n]);
    if (!hit) continue;
    const t = K.nfOnsetTime(hit.n, hit.frac, HOP, sr);
    out.push({
      t,
      // Живьём вспышка случается тогда, когда пришёл кадр n+future и его
      // окно набралось целиком. Офлайн — ровно в t.
      emit: opt.live ? ((hit.n + p.future)*HOP + WIN)/sr : t,
      s: K.nfStrength(hit),
    });
  }
  return out;
}

// Старый алгоритм нормировал силу перцентилем записи — воспроизводим как
// было, иначе сравнение силы между «было» и «стало» ничего не значит.
function norm(out){
  if (!out.length) return out;
  const ref = Math.max(C.nfPct(out.map(o => o.s), 0.90), 1e-9);
  for (const o of out) o.s = Math.min(1.6, o.s/ref);
  return out;
}

/* ------------------------------------------------------------- оценка ---- */
const TOL = 0.05;

function matchRecall(det, marks){
  // Сколько меток накрыто хотя бы одним срабатыванием + ошибки времени.
  let hit = 0; const errs = [], lats = [];
  for (const t of marks){
    let bd = TOL, best = null;
    for (const d of det){ const e = Math.abs(d.t - t); if (e < bd){ bd = e; best = d; } }
    if (best){ hit++; errs.push((best.t - t)*1000); lats.push((best.emit - t)*1000); }
  }
  return { rec: marks.length ? hit/marks.length : 0, errs, lats };
}

function score(det, s, dur){
  const used = new Array(det.length).fill(false);
  let tp = 0;
  for (const t of s.truth){
    let best = -1, bd = TOL;
    for (let i = 0; i < det.length; i++){
      if (used[i]) continue;
      const d = Math.abs(det[i].t - t);
      if (d < bd){ bd = d; best = i; }
    }
    if (best >= 0){ used[best] = true; tp++; }
  }
  const prec = det.length ? tp/det.length : 0;
  const rec  = s.truth.length ? tp/s.truth.length : 0;
  const f1 = prec + rec > 0 ? 2*prec*rec/(prec + rec) : 0;

  const B = matchRecall(det, s.beats);
  // Сильнейшие: берём столько срабатываний, сколько в сцене долей.
  const strong = det.slice().sort((a, b) => b.s - a.s).slice(0, Math.max(1, s.beats.length));
  const S = matchRecall(strong, s.beats);

  const mean = a => a.length ? a.reduce((x, v) => x + v, 0)/a.length : 0;
  const sd = a => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map(v => (v-m)*(v-m)))) : 0; };
  return { f1, prec, rec, beat: B.rec, strong: S.rec,
           bias: mean(B.errs), jit: sd(B.errs), lat: mean(B.lats),
           rate: det.length/dur, pow: C.nfPct(det.map(d => d.s), 0.5) };
}

const padl = (s, n) => String(s).padStart(n);
const padr = (s, n) => String(s).padEnd(n);
const f1s = v => (v >= 0 ? '+' : '') + v.toFixed(1);

function table(title, rows){
  console.log('\n' + title);
  console.log('  ' + padr('сцена', 27) + padl('F1', 6) + padl('доли', 6) + padl('сильн', 7)
              + padl('сдвиг', 8) + padl('разбр', 7) + padl('/с', 6) + padl('сила', 6) + padl('вспышка', 9));
  for (const [name, r] of rows)
    console.log('  ' + padr(name, 27) + padl(r.f1.toFixed(3), 6) + padl(r.beat.toFixed(2), 6)
                + padl(r.strong.toFixed(2), 7) + padl(f1s(r.bias), 8) + padl(r.jit.toFixed(1), 7)
                + padl(r.rate.toFixed(1), 6) + padl(r.pow.toFixed(2), 6) + padl(f1s(r.lat), 9));
  const avg = k => rows.reduce((s, [, r]) => s + r[k], 0)/rows.length;
  console.log('  ' + padr('— среднее —', 27) + padl(avg('f1').toFixed(3), 6) + padl(avg('beat').toFixed(2), 6)
              + padl(avg('strong').toFixed(2), 7) + padl(f1s(avg('bias')), 8) + padl(avg('jit').toFixed(1), 7)
              + padl(avg('rate').toFixed(1), 6) + padl(avg('pow').toFixed(2), 6) + padl(f1s(avg('lat')), 9));
  return { f1: avg('f1'), beat: avg('beat'), strong: avg('strong'), jit: avg('jit') };
}

/* --------------------------------------------------------------- запуск -- */
const argv = process.argv.slice(2);
const LOOK_MS = 25;                 // как по умолчанию в приложении
const wf = Math.max(2, Math.round(LOOK_MS/1000*SR/HOP));

if (argv.includes('--t0')){
  const c = clicks(), st = stft(c.x, SR);
  const { all, low } = newOdf(st, C);
  const p = new C.NfPicker({ future: 24 });
  const errs = [];
  for (let n = 0; n < st.frames; n++){
    const h = p.push(all[n], low[n]);
    if (!h) continue;
    const raw = (h.n + h.frac)*HOP/SR;
    let bd = 1, bt = 0;
    for (const t of c.truth) if (Math.abs(raw - t) < bd){ bd = Math.abs(raw - t); bt = t; }
    if (bd < 0.1) errs.push((raw - bt)*SR/HOP);
  }
  errs.sort((a, b) => a - b);
  const med = errs[errs.length >> 1];
  console.log(`щелчков поймано: ${errs.length} из ${c.truth.length}`);
  console.log(`сырая ошибка, шагов: медиана ${med.toFixed(3)}, среднее ${(errs.reduce((s,v)=>s+v,0)/errs.length).toFixed(3)}`);
  console.log(`NF_T0 должно быть ${(-med).toFixed(2)} (сейчас ${C.NF_T0})`);
  process.exit(0);
}

const S = scenes();
const prep = S.map(s => ({ s, st: stft(s.x, SR) }));

if (argv.includes('--odf')){
  console.log('\nфункция начала: перцентили по сценам (γ = ' + C.NF_GAMMA + ')');
  console.log('  ' + padr('сцена', 27) + ['50%','90%','99%','макс'].map(h => padl(h, 9)).join(''));
  for (const { s, st } of prep){
    const { all } = newOdf(st, C);
    const q = [0.5, 0.9, 0.99].map(p => C.nfPct(all, p));
    let mx = 0; for (const v of all) if (v > mx) mx = v;
    console.log('  ' + padr(s.name, 27) + [...q, mx].map(v => padl(v.toFixed(3), 9)).join(''));
  }
  process.exit(0);
}

// --dump <кусок имени> [сек] — что именно поймано в конкретной сцене.
const dumpAt = argv.indexOf('--dump');
if (dumpAt >= 0){
  const q = argv[dumpAt + 1] || '', upto = +(argv[dumpAt + 2] || 6);
  const P = prep.find(p => p.s.name.includes(q));
  if (!P) throw new Error('сцена не найдена: ' + q);
  const det = newRun(P.st, SR, { future: 24 });
  const { all } = newOdf(P.st, C);
  console.log('\n' + P.s.name + ': первые ' + upto + ' с');
  console.log('  ' + padr('t, с', 9) + padr('что', 22) + padl('сила', 7) + padl('Δ, мс', 8));
  const rows = [];
  for (const t of P.s.truth) if (t < upto)
    rows.push({ t, kind: P.s.beats.includes(t) ? 'доля' : 'событие' });
  for (const d of det) if (d.t < upto) rows.push({ t: d.t, kind: 'вспышка', s: d.s });
  rows.sort((a, b) => a.t - b.t);
  for (const r of rows){
    let d = '';
    if (r.kind === 'вспышка'){
      let bd = 9; for (const t of P.s.truth) if (Math.abs(r.t - t) < Math.abs(bd)) bd = r.t - t;
      d = f1s(bd*1000);
    }
    console.log('  ' + padr(r.t.toFixed(4), 9) + padr(r.kind, 22)
                + padl(r.s != null ? r.s.toFixed(2) : '', 7) + padl(d, 8));
  }
  console.log('\nфункция начала вокруг первой доли:');
  const n0 = Math.max(4, Math.round(P.s.beats[0]*SR/HOP));
  for (let n = n0 - 4; n <= n0 + 6 && n < all.length; n++)
    console.log('  кадр ' + padl(n, 5) + '  t=' + (n*HOP/SR).toFixed(4)
                + '  odf=' + padl(all[n].toFixed(2), 7));
  process.exit(0);
}

if (argv.includes('--look')){
  console.log('\nцена упреждения для живого входа');
  console.log('  ' + padr('мс', 8) + padl('кадров', 8) + padl('F1', 7) + padl('доли', 7)
              + padl('сильн', 7) + padl('вспышка', 9));
  for (const ms of [0, 12, 24, 35, 45, 60, 80, 120, 200]){
    const f = Math.max(2, Math.round(ms/1000*SR/HOP));
    const rows = prep.map(({ s, st }) => [s.name, score(newRun(st, SR, { future: f, live: true }), s, st.dur)]);
    const avg = k => rows.reduce((a, [, r]) => a + r[k], 0)/rows.length;
    console.log('  ' + padr(ms, 8) + padl(f, 8) + padl(avg('f1').toFixed(3), 7)
                + padl(avg('beat').toFixed(2), 7) + padl(avg('strong').toFixed(2), 7)
                + padl(f1s(avg('lat')), 9));
  }
  process.exit(0);
}

if (argv.includes('--sweep')){
  const grid = [];
  for (const g of [1000, 5000, 20000, 80000])
    for (const cap of [0.35, 0.6, 1.0, 9])
      for (const lam of [1.5, 2.0, 2.6])
        grid.push({ g, cap, lam });
  console.log('\nперебор: γ / потолок полосы / λ   (разбор файла, future = 24)');
  console.log('  ' + padr('γ', 7) + padr('потол', 7) + padr('λ', 5)
              + padl('F1', 7) + padl('доли', 7) + padl('сильн', 7) + padl('разбр', 7)
              + padl('эмб/с', 7) + padl('шум/с', 7) + padl('шум сила', 9));
  const best = [];
  for (const { g, cap, lam } of grid){
    const K = core({ NF_GAMMA: g, NF_CAP: cap });
    const rows = prep.map(({ s, st }) => [s.name, score(newRun(st, SR, { future: 24, lam }, K), s, st.dur)]);
    const avg = k => rows.reduce((a, [, r]) => a + r[k], 0)/rows.length;
    const amb = rows.find(([n]) => n.startsWith('эмбиент'))[1];
    const nz  = rows.find(([n]) => n.startsWith('пауза'))[1];
    const e = { g, cap, lam, f1: avg('f1'), beat: avg('beat'), strong: avg('strong'),
                jit: avg('jit'), amb: amb.rate, nz: nz.rate, nzp: nz.pow };
    best.push(e);
    console.log('  ' + padr(g, 7) + padr(cap, 7) + padr(lam, 5)
                + padl(e.f1.toFixed(3), 7) + padl(e.beat.toFixed(2), 7)
                + padl(e.strong.toFixed(2), 7) + padl(e.jit.toFixed(1), 7)
                + padl(e.amb.toFixed(2), 7) + padl(e.nz.toFixed(2), 7) + padl(e.nzp.toFixed(2), 9));
  }
  /* Ранжируем по тому, что важно картинке: попасть в долю, попасть сильно,
     не дрожать и не трещать в паузе. F1 по всем шорохам цели не отражает. */
  const rank = b => b.beat + b.strong + b.f1 - b.jit/50 - b.nzp*1.5 - b.nz/20;
  best.sort((a, b) => rank(b) - rank(a));
  console.log('\nлучшие (доли + сильн + F1 − разброс − треск в паузе):');
  for (const b of best.slice(0, 8))
    console.log(`  γ=${padl(b.g,5)} потолок=${b.cap} λ=${b.lam}  F1=${b.f1.toFixed(3)}`
                + ` доли=${b.beat.toFixed(2)} сильн=${b.strong.toFixed(2)} разбр=${b.jit.toFixed(1)}`
                + ` шум=${b.nz.toFixed(2)}/с сила ${b.nzp.toFixed(2)}`);
  process.exit(0);
}

table('РАЗБОР ФАЙЛА — было',
      prep.map(({ s, st }) => [s.name, score(oldOffline(st, SR), s, st.dur)]));
table('РАЗБОР ФАЙЛА — стало',
      prep.map(({ s, st }) => [s.name, score(newRun(st, SR, { future: 24 }), s, st.dur)]));
table('ЖИВОЙ ВХОД — было (упреждение 120 мс)',
      prep.map(({ s, st }) => [s.name, score(oldLive(st, SR, 10), s, st.dur)]));
table(`ЖИВОЙ ВХОД — стало (упреждение ${LOOK_MS} мс)`,
      prep.map(({ s, st }) => [s.name, score(newRun(st, SR, { future: wf, live: true }), s, st.dur)]));
