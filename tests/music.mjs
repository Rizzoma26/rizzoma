/* Стенд для музыкального времени: доля, сильная доля, дроп.

     node tests/music.mjs           таблица по сценам: файл и живой вход
     node tests/music.mjs --dump N  что происходит внутри на сцене N

   Ядра берутся прямо из noisefield.html — dsp-core (функция начала, удары)
   и music-core (сетка, сильная доля, структура, живые часы). Материал —
   musicScenes() из tests/synth.mjs: грув, брейкдаун, нарастание, дроп.

   Колонки:
     доли     какая часть долей разметки попала в сетку/часы в ±40 мс;
     сильн    какая часть сильных долей разметки стоит на фазе такта 0
              (у живых часов — после первых восьми тактов на захват);
     дропы    найдено / в разметке, у файла допуск ±1 доля, живьём ±1 такт;
     ложн     дропов, которых нет в разметке, в минуту.                    */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { musicScenes, SR } from './synth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, '..', 'noisefield.html'), 'utf8');

function block(name){
  const a = HTML.indexOf(`/* ==== ${name}:start`), b = HTML.indexOf(`/* ==== ${name}:end`);
  if (a < 0 || b < a) throw new Error('в noisefield.html не найден блок ' + name);
  return HTML.slice(a, b);
}
const C = new Function(block('dsp-core') + block('music-core') + `
  return { nfFFT, nfBands, nfOdfState, nfOdfStep, NfPicker, nfStrength, nfOnsetTime, nfPct,
           nfGrid, nfBeatTrack, nfDownbeat, nfStructure, NfClock };`)();

const HOP = 512, WIN = 1024, BINS = 32, LO = 40, HI = 16000;
const B_BASS = [0, 7], B_HIGH = [21, 32];

function analyse(x){
  const frames = Math.max(1, Math.floor((x.length - WIN)/HOP));
  const fft = C.nfFFT(WIN), rng = C.nfBands(SR, WIN, BINS, LO, HI);
  const re = new Float32Array(WIN), im = new Float32Array(WIN), han = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) han[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(WIN-1));
  const mag = new Float32Array(frames*BINS), odf = new Float32Array(frames), odfL = new Float32Array(frames);
  const st = C.nfOdfState(BINS), col = new Float32Array(BINS);
  for (let n = 0; n < frames; n++){
    for (let i = 0; i < WIN; i++){ re[i] = x[n*HOP + i]*han[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < BINS; k++){
      const [a, b] = rng[k]; let s = 0;
      for (let i = a; i <= b; i++) s += Math.sqrt(re[i]*re[i] + im[i]*im[i]);
      col[k] = mag[n*BINS + k] = s/(b - a + 1)*4/WIN;
    }
    const r = C.nfOdfStep(st, col, BINS); odf[n] = r.all; odfL[n] = r.low;
  }
  // Полосы — как в analyzeTrack: к 97-му перцентилю своей полосы, среднее по группе.
  const norm = new Float32Array(BINS), lane = new Float32Array(frames);
  for (let k = 0; k < BINS; k++){
    for (let n = 0; n < frames; n++) lane[n] = mag[n*BINS + k];
    norm[k] = Math.max(C.nfPct(lane, 0.97), 1e-7);
  }
  const grp = (r, n) => { let s = 0; for (let k = r[0]; k < r[1]; k++) s += Math.min(1, mag[n*BINS + k]/norm[k]); return s/(r[1] - r[0]); };
  const low = new Float32Array(frames), high = new Float32Array(frames);
  for (let n = 0; n < frames; n++){ low[n] = grp(B_BASS, n); high[n] = grp(B_HIGH, n); }
  return { frames, odf, odfL, low, high };
}

const near = (arr, t) => { let b = 1e9; for (const a of arr) if (Math.abs(a - t) < Math.abs(b)) b = a - t; return b; };

function runFile(s, A){
  const G = C.nfGrid(A.odf, A.frames, SR, HOP);
  const grid = G.conf > 2 ? C.nfBeatTrack(G.nov, G.lagFrames, A.frames, HOP, SR) : [];
  const down = C.nfDownbeat(grid, A.odf, A.odfL, A.low, HOP, SR);
  const form = C.nfStructure(grid, down, A.low, A.high, HOP, SR);
  let hit = 0; const errs = [];
  for (const t of s.beats){ const e = near(grid, t); if (Math.abs(e) < 0.04){ hit++; errs.push(e*1000); } }
  let dh = 0;
  const downs = grid.filter((_, i) => i >= down && (i - down) % 4 === 0);
  for (const t of s.downs) if (Math.abs(near(downs, t)) < 0.06) dh++;
  const q = 60/s.bpm;
  const found = s.drops.filter(t => form.drops.some(d => Math.abs(d - t) < q*1.01)).length;
  const fals = form.drops.filter(d => !s.drops.some(t => Math.abs(d - t) < q*1.01)).length;
  return { beats: hit/s.beats.length, downs: dh/s.downs.length, found, fals, errs,
           bpm: G.period ? 60/G.period : 0, drops: form.drops, down };
}

function runLive(s, A){
  // Удары — тем же отборщиком, что у живого входа, с упреждением по умолчанию.
  const fut = 2, P = new C.NfPicker({ future: fut, lam: 0.9 + 11*0.10 });
  const clk = new C.NfClock(), dt = HOP/SR;
  // Часы идут по времени картинки: кадр, о котором отборщик только что вынес
  // решение. Удар приходит в них ровно в момент своего онсета.
  const vis = n => C.nfOnsetTime(n - fut, 0, HOP, SR);
  const state = [], drops = [], kicks = [];
  let bl = 0, hl = 0;
  for (let n = 0; n < A.frames; n++){
    const hitv = P.push(A.odf[n], A.odfL[n]);
    const d = n - fut;
    if (d >= 0){
      bl += (A.low[d] - bl)*0.35; hl += (A.high[d] - hl)*0.35;
      if (hitv){
        const ks = Math.min(1.5, C.nfStrength(hitv)*1.2), kl = hitv.v > 0 ? Math.min(1, hitv.low/hitv.v) : 0;
        clk.kick(ks, kl);
        kicks.push([vis(n), ks, kl, clk.state]);
      }
      const m = clk.step(dt, bl, hl);
      if (m.dropHit) drops.push(vis(n));
      state.push({ t: vis(n), ...m });
    }
  }
  const at = t => { let lo = 0, hi = state.length - 1;
    while (hi - lo > 1){ const mid = (lo + hi) >> 1; if (state[mid].t <= t) lo = mid; else hi = mid; }
    return state[lo]; };
  const q = 60/s.bpm, lock = s.downs[Math.min(8, s.downs.length - 1)];
  let hit = 0, tot = 0;
  for (const t of s.beats){
    if (t < lock) continue;
    const m = at(t); tot++;
    const e = Math.min(m.beat, 1 - m.beat)*q;
    if (e < 0.04) hit++;
  }
  let dh = 0, dt2 = 0;
  for (const t of s.downs){
    if (t < lock) continue;
    const m = at(t); dt2++;
    const e = Math.min(m.bar, 1 - m.bar)*4;       // в долях
    if (e < 0.25) dh++;
  }
  const found = s.drops.filter(t => drops.some(d => Math.abs(d - t) < 4*q)).length;
  const fals = drops.filter(d => !s.drops.some(t => Math.abs(d - t) < 4*q)).length;
  return { beats: tot ? hit/tot : 0, downs: dt2 ? dh/dt2 : 0, found, fals, drops, state, kicks };
}

const arg = process.argv.slice(2);
const SC = musicScenes();
const pct = v => (v*100).toFixed(0).padStart(4) + '%';
const dump = arg.indexOf('--dump');

console.log('\n' + 'сцена'.padEnd(26) + '│ файл: доли сильн дропы ложн/мин │ живьём: доли сильн дропы ложн/мин');
console.log('─'.repeat(26) + '┼' + '─'.repeat(32) + '┼' + '─'.repeat(34));
const tot = { f: [0,0,0,0,0], l: [0,0,0,0,0] };
SC.forEach((s, i) => {
  const A = analyse(s.x), F = runFile(s, A), L = runLive(s, A);
  const mins = s.x.length/SR/60;
  console.log(s.name.padEnd(26) + '│' +
    pct(F.beats) + '  ' + pct(F.downs) + '   ' + `${F.found}/${s.drops.length}`.padStart(4) + '  ' + (F.fals/mins).toFixed(1).padStart(6) + '    │' +
    pct(L.beats) + '   ' + pct(L.downs) + '  ' + `${L.found}/${s.drops.length}`.padStart(4) + '  ' + (L.fals/mins).toFixed(1).padStart(6));
  tot.f[0] += F.beats; tot.f[1] += F.downs; tot.f[2] += F.found; tot.f[3] += s.drops.length; tot.f[4] += F.fals;
  tot.l[0] += L.beats; tot.l[1] += L.downs; tot.l[2] += L.found; tot.l[3] += s.drops.length; tot.l[4] += L.fals;
  if (dump >= 0 && +arg[dump + 1] === i){
    console.log('  файл: bpm', F.bpm.toFixed(2), 'сильная доля', F.down, 'дропы', F.drops.map(t => t.toFixed(2)).join(' '),
                '· разметка', s.drops.map(t => t.toFixed(2)).join(' '));
    const e = F.errs.slice().sort((a, b) => a - b);
    if (e.length) console.log('  ошибка долей, мс: медиана', e[e.length >> 1].toFixed(1), 'разброс', (e[Math.floor(e.length*0.9)] - e[Math.floor(e.length*0.1)]).toFixed(1));
    console.log('  живьём: дропы', L.drops.map(t => t.toFixed(2)).join(' '));
    const w = arg[dump + 2] ? arg[dump + 2].split('-').map(Number) : null;
    if (w) for (const [t, ks, kl, st] of L.kicks) if (t >= w[0] && t <= w[1])
      console.log('    удар', t.toFixed(2), 'сила', ks.toFixed(2), 'низ', kl.toFixed(2), st);
    for (let k = 0; k < L.state.length; k += 86){
      const m = L.state[k];
      const j = s.downs.findIndex(d => d > m.t) - 1, tb = j >= 0 ? (m.t - s.downs[j])/(s.downs[j+1] - s.downs[j]) : 0;
      console.log('   ', m.t.toFixed(1).padStart(5), m.section.padEnd(11), 'bpm', m.bpm.toFixed(1), 'bar', m.bar.toFixed(2),
                  'разметка', tb.toFixed(2), 'down', m.down, 'заряд', m.charge.toFixed(2));
    }
  }
});
const n = SC.length;
console.log('─'.repeat(26) + '┼' + '─'.repeat(32) + '┼' + '─'.repeat(34));
console.log('среднее'.padEnd(26) + '│' + pct(tot.f[0]/n) + '  ' + pct(tot.f[1]/n) + '   ' + `${tot.f[2]}/${tot.f[3]}`.padStart(4) + '  ' + `${tot.f[4]} всего`.padStart(8) + '  │' +
            pct(tot.l[0]/n) + '   ' + pct(tot.l[1]/n) + '  ' + `${tot.l[2]}/${tot.l[3]}`.padStart(4) + '  ' + `${tot.l[4]} всего`.padStart(8));
