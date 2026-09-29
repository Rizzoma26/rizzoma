/* Тестовый материал.

   Настоящие записи сюда не положить — права, вес, да и разметка ударов в них
   всё равно ручная и приблизительная. А мерить надо именно попадание во
   время, с точностью до отсчёта. Поэтому материал синтезируется, зато
   разметка точна по определению: мы сами знаем, в какой отсчёт поставили
   удар.

   Задача материала — не звучать красиво, а ломать детектор ровно теми
   способами, какими его ломает живая музыка:
     · басовая нота в той же полосе, что и кик, и не на доле;
     · 808 с полусекундным хвостом и глайдом — вечный источник ложных пиков;
     · сайдчейн: пад «выныривает» после кика, и подъём читается как удар;
     · щётки и райд — мягкие атаки без низа вообще;
     · пад с медленным нарастанием — не событие, трогать не должен;
     · перегруженная гитара — широкополосная атака без баса;
     · плавающий темп;
     · тихая динамичная запись против закатанного в потолок мастера.       */

export const SR = 44100;
const TAU = Math.PI * 2;

// Свой генератор псевдослучайных: тесты обязаны повторяться от запуска к
// запуску, иначе сравнивать два алгоритма бессмысленно.
export function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function mix(out, sig, at, g){
  const n = Math.min(sig.length, out.length - at);
  for (let i = 0; i < n; i++) out[at + i] += sig[i] * g;
}

/* ---------------------------------------------------------- инструменты -- */

function kick(R, { f0 = 155, f1 = 47, dec = 0.30, click = 0.5, g = 1 } = {}){
  const n = Math.round(dec * SR * 1.8) | 0, x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++){
    const t = i / SR;
    ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / 0.030)) / SR;
    x[i] = Math.sin(ph) * Math.exp(-t / (dec * 0.36));
    if (t < 0.005) x[i] += (R() * 2 - 1) * click * Math.exp(-t / 0.0012);
  }
  for (let i = 0; i < n; i++) x[i] = Math.tanh(x[i] * 1.7) * 0.62 * g;
  return x;
}

// 808: длинный хвост и глайд. Хвост живёт в полосе кика и мешает следующему.
function sub808(R, { f = 52, dec = 0.55, g = 1 } = {}){
  const n = Math.round(dec * SR * 2.2) | 0, x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++){
    const t = i / SR;
    ph += TAU * (f * (1 + 1.4 * Math.exp(-t / 0.045))) / SR;
    x[i] = Math.tanh(Math.sin(ph) * 1.3) * Math.exp(-t / (dec * 0.5)) * 0.55 * g;
  }
  return x;
}

function snare(R, { dec = 0.15, g = 1, tone = 195 } = {}){
  const n = Math.round(dec * SR * 2.4) | 0, x = new Float32Array(n);
  let ph = 0, lp = 0;
  for (let i = 0; i < n; i++){
    const t = i / SR, e = Math.exp(-t / (dec * 0.42));
    ph += TAU * tone / SR;
    const nz = R() * 2 - 1;
    lp += (nz - lp) * 0.45;
    x[i] = (Math.sin(ph) * 0.45 + (nz - lp * 0.6) * 0.95) * e * 0.5 * g;
  }
  return x;
}

function hat(R, { dec = 0.035, g = 1 } = {}){
  const n = Math.round(dec * SR * 3.5) + 16 | 0, x = new Float32Array(n);
  let hp = 0, prev = 0;
  for (let i = 0; i < n; i++){
    const nz = R() * 2 - 1;
    hp = 0.88 * (hp + nz - prev); prev = nz;
    x[i] = hp * Math.exp(-(i / SR) / (dec * 0.4)) * 0.34 * g;
  }
  return x;
}

// Хлопок: четыре очереди подряд. Начало события — первая, детектор должен
// поймать её, а не размазанный хвост.
function clap(R, { g = 1 } = {}){
  const n = Math.round(0.30 * SR) | 0, x = new Float32Array(n);
  const bursts = [0, 0.011, 0.021, 0.032];
  let hp = 0, prev = 0;
  for (let i = 0; i < n; i++){
    const t = i / SR;
    let e = Math.exp(-Math.max(0, t - 0.032) / 0.055) * 0.55;
    for (const b of bursts) if (t >= b && t < b + 0.008) e = 1;
    const nz = R() * 2 - 1;
    hp = 0.80 * (hp + nz - prev); prev = nz;
    x[i] = hp * e * 0.42 * g;
  }
  return x;
}

// Райд и щётки: мягкая атака, никакого низа. Самое трудное для детектора,
// который смотрит только на бас.
function ride(R, { dec = 0.55, g = 1, soft = 0.004 } = {}){
  const n = Math.round(dec * SR * 2) | 0, x = new Float32Array(n);
  let hp = 0, prev = 0, bp = 0;
  for (let i = 0; i < n; i++){
    const t = i / SR;
    const nz = R() * 2 - 1;
    hp = 0.90 * (hp + nz - prev); prev = nz;
    bp += (hp - bp) * 0.35;
    const atk = 1 - Math.exp(-t / soft);
    x[i] = bp * atk * Math.exp(-t / (dec * 0.5)) * 0.30 * g;
  }
  return x;
}

function brush(R, { dec = 0.22, g = 1 } = {}){
  return ride(R, { dec, g: g * 0.8, soft: 0.012 });
}

function tom(R, { f = 110, dec = 0.28, g = 1 } = {}){
  const n = Math.round(dec * SR * 2) | 0, x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++){
    const t = i / SR;
    ph += TAU * (f * (1 + 0.35 * Math.exp(-t / 0.05))) / SR;
    x[i] = Math.sin(ph) * Math.exp(-t / (dec * 0.4)) * 0.5 * g;
  }
  return x;
}

// Пила через двухполюсный ФНЧ — бас и гитара. attack задаёт, событие это
// или подкрадывание.
function tone(R, { f = 55, dur = 0.5, g = 1, cut = 0.10, atk = 0.004, rel = 0.05,
                   drive = 1, saw = 1 } = {}){
  const n = Math.round((dur + rel) * SR) | 0, x = new Float32Array(n);
  let ph = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++){
    const t = i / SR;
    ph += f / SR; if (ph >= 1) ph -= 1;
    const s = saw ? (ph * 2 - 1) : Math.sin(TAU * ph);
    y1 += (s - y1) * cut; y2 += (y1 - y2) * cut;
    const e = Math.min(1, t / atk) * (t > dur ? Math.exp(-(t - dur) / rel) : 1);
    x[i] = Math.tanh(y2 * drive) * e * 0.45 * g;
  }
  return x;
}

// Пад: нарастает триста миллисекунд. Это НЕ событие — сработать на нём
// значит соврать.
function pad(R, { freqs = [220, 277, 330], dur = 2, g = 1 } = {}){
  const n = Math.round((dur + 0.5) * SR) | 0, x = new Float32Array(n);
  for (const f of freqs){
    let ph = 0, y1 = 0, y2 = 0;
    const det = 1 + (R() - 0.5) * 0.01;
    for (let i = 0; i < n; i++){
      const t = i / SR;
      ph += f * det / SR; if (ph >= 1) ph -= 1;
      y1 += ((ph * 2 - 1) - y1) * 0.06; y2 += (y1 - y2) * 0.06;
      const e = Math.min(1, t / 0.30) * (t > dur ? Math.exp(-(t - dur) / 0.35) : 1);
      x[i] += y2 * e * 0.30 * g / freqs.length;
    }
  }
  return x;
}

/* ------------------------------------------------------------- мастеринг -- */

// Мягкий лимитер: то, что делает с транзиентами настоящий мастер. Пики
// придавливаются, и детектору, который смотрит на амплитуду, становится
// заметно хуже.
function limit(x, drive = 1.6){
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) * 0.92;
  return x;
}

// Сайдчейн: всё, кроме кика, ныряет под него и возвращается за 200 мс.
// Возврат — это подъём уровня, и он честно похож на начало ноты.
function duck(x, times, depth = 0.75, rel = 0.20){
  const g = new Float32Array(x.length).fill(1);
  for (const t of times){
    const a = Math.round(t * SR);
    for (let i = 0; i < rel * SR && a + i < g.length; i++)
      g[a + i] = Math.min(g[a + i], 1 - depth * Math.exp(-(i / SR) / (rel * 0.4)));
  }
  for (let i = 0; i < x.length; i++) x[i] *= g[i];
  return x;
}

/* ----------------------------------------------------------------- сцены -- */

const sec = (bar, beat, div, bpm) => (bar * 4 + beat + div) * 60 / bpm;

function make(dur){ return new Float32Array(Math.round(dur * SR)); }

/* Каждая сцена возвращает сигнал и разметку: truth — все перкуссионные
   события (по ним считается попадание), beats — только доли (по ним видно,
   держит ли картинка сетку). */

function techno(){
  const R = rng(11), bpm = 128, dur = 24;
  // Бочка живёт отдельной шиной: сайдчейн давит всё, КРОМЕ неё, иначе
  // ducking съедает собственную атаку кика и материал врёт про времена.
  const kicks = make(dur), bed = make(dur), truth = [], beats = [];
  const bar = 4 * 60 / bpm;
  for (let b = 0; b * bar < dur - 1; b++){
    for (let q = 0; q < 4; q++){
      const t = b * bar + q * 60 / bpm;
      mix(kicks, kick(R, { g: 1.0 }), Math.round(t * SR), 1);
      truth.push(t); beats.push(t);
      // офбитовый бас — в полосе кика, но событием для картинки не считается
      mix(bed, tone(R, { f: 49, dur: 0.22, cut: 0.06, atk: 0.02, g: 0.9 }),
          Math.round((t + 0.5 * 60 / bpm) * SR), 1);
      const th = t + 0.5 * 60 / bpm;               // закрытые хэты по восьмым
      mix(bed, hat(R, { g: 0.8 }), Math.round(th * SR), 1);
      truth.push(th);
    }
    for (const q of [1, 3]){
      const t = b * bar + q * 60 / bpm;
      mix(bed, clap(R, { g: 0.9 }), Math.round(t * SR), 1);
      truth.push(t);
    }
  }
  mix(bed, pad(R, { freqs: [110, 165, 220], dur: dur - 1, g: 0.8 }), 0, 1);
  duck(bed, beats, 0.45);
  const x = make(dur);
  for (let i = 0; i < x.length; i++) x[i] = kicks[i] + bed[i];
  return { name: 'техно 128', x: limit(x, 1.8), truth, beats, bpm };
}

function dnb(){
  const R = rng(23), bpm = 174, dur = 24;
  const x = make(dur), truth = [], beats = [];
  const bar = 4 * 60 / bpm, q = 60 / bpm;
  for (let b = 0; b * bar < dur - 1; b++){
    const T = b * bar;
    const S = [q, 3 * q];
    for (const k of [0, 2.5 * q]){ mix(x, kick(R, { dec: 0.22, g: 1 }), Math.round((T + k) * SR), 1); truth.push(T + k); }
    for (const s of S){ mix(x, snare(R, { g: 1 }), Math.round((T + s) * SR), 1); truth.push(T + s); beats.push(T + s); }
    // призрачные малые — тихие, но настоящие
    for (const s of [1.75 * q, 3.5 * q]){ mix(x, snare(R, { dec: 0.07, g: 0.32 }), Math.round((T + s) * SR), 1); truth.push(T + s); }
    for (let i = 0; i < 8; i++){
      const th = T + i * q / 2;
      mix(x, hat(R, { g: i % 2 ? 0.5 : 0.75 }), Math.round(th * SR), 1);
      truth.push(th);
    }
    beats.push(T, T + 2 * q);
    // саб тянется через весь такт — низа много, событий в нём нет
    mix(x, tone(R, { f: 41, dur: bar * 0.9, cut: 0.05, atk: 0.03, g: 1.1 }), Math.round(T * SR), 1);
  }
  return { name: 'драм-энд-бейс 174', x: limit(x, 1.6), truth, beats, bpm };
}

function hiphop(){
  const R = rng(37), bpm = 88, dur = 26;
  const x = make(dur), truth = [], beats = [];
  const q = 60 / bpm, bar = 4 * q, sw = 0.06 * q;   // свинг
  for (let b = 0; b * bar < dur - 2; b++){
    const T = b * bar;
    for (const k of [0, 1.5 * q, 2.75 * q]){
      mix(x, sub808(R, { f: b % 2 ? 48 : 55, g: 1.05 }), Math.round((T + k) * SR), 1);
      truth.push(T + k);
    }
    for (const s of [q, 3 * q]){
      mix(x, snare(R, { dec: 0.18, g: 0.95 }), Math.round((T + s) * SR), 1);
      truth.push(T + s); beats.push(T + s);
    }
    beats.push(T, T + 2 * q);
    for (let i = 0; i < 8; i++){
      const th = T + i * q / 2 + (i % 2 ? sw : 0);
      mix(x, hat(R, { dec: i % 4 === 3 ? 0.12 : 0.03, g: 0.6 }), Math.round(th * SR), 1);
      truth.push(th);
    }
    mix(x, pad(R, { freqs: [147, 185, 220], dur: bar * 0.9, g: 0.7 }), Math.round(T * SR), 1);
  }
  return { name: 'хип-хоп 88 (808)', x: limit(x, 1.5), truth, beats, bpm };
}

function rock(){
  const R = rng(41), bpm = 142, dur = 24;
  const x = make(dur), truth = [], beats = [];
  const q = 60 / bpm, bar = 4 * q;
  for (let b = 0; b * bar < dur - 1; b++){
    const T = b * bar;
    for (const k of [0, 2 * q, 2.5 * q]){ mix(x, kick(R, { f0: 190, dec: 0.20, g: 0.95 }), Math.round((T + k) * SR), 1); truth.push(T + k); }
    for (const s of [q, 3 * q]){ mix(x, snare(R, { dec: 0.20, g: 1.05 }), Math.round((T + s) * SR), 1); truth.push(T + s); beats.push(T + s); }
    beats.push(T, T + 2 * q);
    for (let i = 0; i < 8; i++){
      const th = T + i * q / 2;
      mix(x, ride(R, { dec: 0.3, g: 0.55 }), Math.round(th * SR), 1);
      truth.push(th);
    }
    // перегруженная гитара: широкополосная атака без низа, тянется весь такт
    for (const c of [0, 2 * q]){
      mix(x, tone(R, { f: 98, dur: 2 * q * 0.95, cut: 0.28, atk: 0.006, drive: 6, g: 0.8 }),
          Math.round((T + c) * SR), 1);
      truth.push(T + c);
    }
    if (b % 4 === 3) for (const f of [160, 130, 100]){
      const tt = T + 3.5 * q + (160 - f) / 200;
      mix(x, tom(R, { f, g: 0.9 }), Math.round(tt * SR), 1); truth.push(tt);
    }
  }
  return { name: 'рок 142', x: limit(x, 2.0), truth, beats, bpm };
}

function funk(){
  const R = rng(53), bpm = 104, dur = 24;
  const x = make(dur), truth = [], beats = [];
  const q = 60 / bpm, bar = 4 * q;
  for (let b = 0; b * bar < dur - 1; b++){
    const T = b * bar;
    for (const k of [0, 0.75 * q, 2.5 * q, 3.25 * q]){ mix(x, kick(R, { dec: 0.18, g: 0.9 }), Math.round((T + k) * SR), 1); truth.push(T + k); }
    for (const s of [q, 3 * q]){ mix(x, snare(R, { g: 1 }), Math.round((T + s) * SR), 1); truth.push(T + s); beats.push(T + s); }
    beats.push(T, T + 2 * q);
    for (let i = 0; i < 16; i++){
      const th = T + i * q / 4;
      const g = i % 4 === 0 ? 0.8 : (i % 2 ? 0.28 : 0.5);
      mix(x, hat(R, { dec: 0.025, g }), Math.round(th * SR), 1);
      truth.push(th);
    }
    // слэп-бас шестнадцатыми — атаки есть, но событиями сетки не являются
    for (const s of [0, 1.25 * q, 2 * q, 3.5 * q]){
      mix(x, tone(R, { f: 82, dur: 0.16, cut: 0.22, atk: 0.002, drive: 3, g: 0.7 }),
          Math.round((T + s) * SR), 1);
      truth.push(T + s);
    }
  }
  return { name: 'фанк 104', x: limit(x, 1.7), truth, beats, bpm };
}

function jazz(){
  const R = rng(67), bpm = 122, dur = 26;
  const x = make(dur), truth = [], beats = [];
  const q = 60 / bpm, bar = 4 * q;
  for (let b = 0; b * bar < dur - 2; b++){
    const T = b * bar;
    // свинговый райд: 1, 2&(триоль), 2 ...
    for (const r of [0, q, q * 1.66, 2 * q, 3 * q, 3 * q * 1.111]){
      const tt = T + r;
      mix(x, ride(R, { dec: 0.5, g: 0.5 }), Math.round(tt * SR), 1);
      truth.push(tt);
    }
    for (const s of [1.66 * q, 3.66 * q]){
      mix(x, brush(R, { g: 0.55 }), Math.round((T + s) * SR), 1); truth.push(T + s);
    }
    beats.push(T, T + q, T + 2 * q, T + 3 * q);
    // ходячий контрабас: щипок мягкий, но слышный
    for (let i = 0; i < 4; i++){
      const f = [65, 73, 82, 98][i];
      const tt = T + i * q;
      mix(x, tone(R, { f, dur: q * 0.9, cut: 0.05, atk: 0.008, saw: 0, g: 1.0 }), Math.round(tt * SR), 1);
      truth.push(tt);
    }
  }
  return { name: 'джаз 122 (щётки)', x: limit(x, 1.2), truth, beats, bpm };
}

function ambient(){
  const R = rng(71), dur = 24;
  const x = make(dur), truth = [], beats = [];
  for (let i = 0; i < 6; i++)
    mix(x, pad(R, { freqs: [110 * (1 + i * 0.02), 164, 220, 330], dur: 5, g: 0.9 }),
        Math.round(i * 3.7 * SR), 1);
  // редкие мягкие удары молоточком — единственные события
  for (const t of [2.0, 7.3, 12.9, 18.4]){
    mix(x, tone(R, { f: 440, dur: 0.4, cut: 0.5, atk: 0.003, saw: 0, g: 0.8 }), Math.round(t * SR), 1);
    truth.push(t); beats.push(t);
  }
  return { name: 'эмбиент (почти без событий)', x: limit(x, 1.1), truth, beats, bpm: 0 };
}

function drift(){
  const R = rng(83), dur = 26;
  const x = make(dur), truth = [], beats = [];
  let t = 0.2, bpm = 120;
  while (t < dur - 1){
    mix(x, kick(R, { g: 1 }), Math.round(t * SR), 1);
    truth.push(t); beats.push(t);
    const th = t + 30 / bpm;
    mix(x, hat(R, { g: 0.7 }), Math.round(th * SR), 1); truth.push(th);
    bpm = 120 + 9 * Math.sin(t / 5);            // темп гуляет ±7%
    t += 60 / bpm;
  }
  mix(x, pad(R, { freqs: [98, 147, 196], dur: dur - 1, g: 0.7 }), 0, 1);
  return { name: 'плавающий темп', x: limit(x, 1.5), truth, beats, bpm: 0 };
}

// Шум предусилителя. На линейном входе с пульта он есть всегда, и от него
// зависит выбор компрессии: слишком большая γ вытаскивает этот шум в
// логарифм наравне с музыкой, и детектор начинает видеть удары в тишине.
function hiss(x, db = -68){
  const R = rng(1009), a = Math.pow(10, db/20);
  let lp = 0;
  for (let i = 0; i < x.length; i++){
    const n = R()*2 - 1;
    lp += (n - lp)*0.35;                    // чуть розовее белого
    x[i] += (n*0.6 + lp*1.4)*a;
  }
  return x;
}

// Пауза между треками: шипит пульт, вдалеке кто-то хлопает. Вспышек здесь
// быть почти не должно.
function silence(){
  const R = rng(1013), dur = 20;
  const x = make(dur), truth = [], beats = [];
  for (const t of [3.1, 8.7, 13.2, 17.6]){
    mix(x, clap(R, { g: 0.08 }), Math.round(t*SR), 1);
    truth.push(t); beats.push(t);
  }
  return { name: 'пауза: шум пульта', x: hiss(x, -62), truth, beats, bpm: 0 };
}

function quiet(){
  const t = techno();
  const x = new Float32Array(t.x.length);
  // тихая динамичная запись: −26 дБ и дыхание громкости
  for (let i = 0; i < x.length; i++)
    x[i] = t.x[i] * 0.05 * (0.55 + 0.45 * Math.sin(i / SR / 3));
  return { name: 'тихий динамичный мастер', x, truth: t.truth, beats: t.beats, bpm: t.bpm };
}

export function scenes(){
  // Шум предусилителя подмешивается ко всем сценам: живой вход без него не
  // бывает, а разбор файла он не портит.
  return [techno(), dnb(), hiphop(), rock(), funk(), jazz(), ambient(), drift(), quiet()]
    .map(s => ({ ...s, x: hiss(s.x, -68) }))
    .concat([silence()]);
}

/* ------------------------------------------------- треки со структурой -- */
/* Материал для музыкального времени (tests/music.mjs). Здесь важны не
   отдельные удары, а форма: грув, брейкдаун без бочки и баса, нарастание с
   райзером и дробью малого, дроп на сильную долю. Разметка — доли, сильные
   доли и дропы, все точные.

   bpmAt(bar) задаёт темп по тактам — так делается и дрейф. */

// Райзер: шум, который светлеет и громче к концу.
function riser(R, dur, g = 1){
  const n = Math.round(dur*SR) | 0, x = new Float32Array(n);
  let lp = 0, hp = 0, prev = 0;
  for (let i = 0; i < n; i++){
    const t = i/n, nz = R()*2 - 1;
    const a = 0.02 + 0.5*t*t;
    lp += (nz - lp)*a; hp = (1 - a*0.6)*(hp + lp - prev); prev = lp;
    x[i] = hp*t*t*0.35*g;
  }
  return x;
}

function arrange(name, seed, bars, bpmAt, plan){
  const R = rng(seed);
  const starts = []; let t = 0.25;
  for (let b = 0; b <= bars; b++){ starts.push(t); t += 4*60/bpmAt(b); }
  const dur = t + 1.5;
  const kicks = make(dur), bed = make(dur), beats = [], downs = [], drops = [], kickT = [];
  let prevFull = true, emptyRun = 0;
  for (let b = 0; b < bars; b++){
    const q = 60/bpmAt(b), T = starts[b], kind = plan(b);   // 'грув' | 'пусто' | 'нарастание'
    downs.push(T);
    for (let i = 0; i < 4; i++) beats.push(T + i*q);
    if (kind === 'грув'){
      if (!prevFull && emptyRun >= 2) drops.push(T);
      for (let i = 0; i < 4; i++){
        const tt = T + i*q;
        mix(kicks, kick(R, { g: 1.0 }), Math.round(tt*SR), 1); kickT.push(tt);
        mix(bed, tone(R, { f: 49, dur: q*0.45, cut: 0.06, atk: 0.02, g: 0.9 }), Math.round((tt + q*0.5)*SR), 1);
        mix(bed, hat(R, { g: 0.7 }), Math.round((tt + q*0.5)*SR), 1);
      }
      for (const i of [1, 3]) mix(bed, clap(R, { g: 0.85 }), Math.round((T + i*q)*SR), 1);
      // сбивка в конце каждой восьмёрки — фраза, а не петля
      if (b % 8 === 7) for (const [o, f] of [[3, 160], [3.5, 120]])
        mix(bed, tom(R, { f, g: 0.7 }), Math.round((T + o*q)*SR), 1);
      prevFull = true; emptyRun = 0;
    } else {
      // брейкдаун: ни бочки, ни баса; пад, хэты, к концу — райзер и дробь
      for (let i = 0; i < 8; i++) mix(bed, hat(R, { g: kind === 'нарастание' ? 0.55 : 0.3 }),
                                        Math.round((T + i*q/2)*SR), 1);
      if (kind === 'нарастание'){
        mix(bed, riser(R, 4*q, 1.0), Math.round(T*SR), 1);
        const div = b % 2 ? 8 : 4;                     // дробь учащается
        for (let i = 0; i < div; i++) mix(bed, snare(R, { dec: 0.08, g: 0.35 + 0.4*i/div }),
                                           Math.round((T + i*4*q/div)*SR), 1);
      }
      prevFull = false; emptyRun++;
    }
    if (b % 4 === 0) mix(bed, pad(R, { freqs: [110, 165, 220], dur: 4*q*0.95, g: 0.6 }), Math.round(T*SR), 1);
  }
  duck(bed, kickT, 0.45);
  const x = make(dur);
  for (let i = 0; i < x.length; i++) x[i] = kicks[i] + bed[i];
  return { name, x: hiss(limit(x, 1.7), -68), beats, downs, drops, bpm: bpmAt(0) };
}

export function musicScenes(){
  return [
    arrange('брейкдаун и дроп 128', 201, 24, () => 128,
            b => b < 8 ? 'грув' : b < 12 ? 'пусто' : b < 16 ? 'нарастание' : 'грув'),
    arrange('ровно, без дропа 132', 202, 24, () => 132, () => 'грув'),
    arrange('два дропа 124', 203, 32, () => 124,
            b => b < 8 ? 'грув' : b < 10 ? 'пусто' : b < 12 ? 'нарастание' : b < 20 ? 'грув'
               : b < 22 ? 'пусто' : b < 24 ? 'нарастание' : 'грув'),
    arrange('дрейф 122→128 и дроп', 204, 28, b => 122 + 6*Math.min(1, b/27),
            b => b < 10 ? 'грув' : b < 13 ? 'пусто' : b < 16 ? 'нарастание' : 'грув'),
  ];
}

// Отдельно: щелчки в точно известные отсчёты. Ими меряется систематический
// сдвиг детектора — то, из-за чего картинка уезжает от доли.
export function clicks(){
  const dur = 12, x = make(dur), truth = [];
  const R = rng(97);
  for (let i = 0; i < 20; i++){
    const t = 0.5 + i * 0.55 + (i % 3) * 0.013;
    const a = Math.round(t * SR);
    for (let j = 0; j < 64; j++) x[a + j] += Math.exp(-j / 6) * (j === 0 ? 1 : (R() * 2 - 1) * 0.8);
    truth.push(t);
  }
  return { name: 'щелчки', x, truth, beats: truth.slice(), bpm: 0 };
}
