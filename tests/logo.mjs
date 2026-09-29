/* Сверка формулы знака с картинкой.

     node tests/logo.mjs              IoU по всему знаку и по частям
     node tests/logo.mjs --png f.png  карта расхождений: красное — есть на
                                      картинке, нет в формуле; синее — наоборот
     node tests/logo.mjs --fit        покоординатная подгонка чисел LOGO и
                                      посадки картинки; печатает найденное

   Формула берётся прямо из noisefield.html (блок logo-core), картинка — из
   ref/logo.png. Пакетов нет: PNG разбирается встроенным zlib.

   IoU по части считается в её окрестности: пиксели, где ближайшая часть по
   формуле — эта, и до края не дальше 0.08 единицы. Иначе ошибка кольца
   тонула бы в площади стержня, а стрелки — в фоне.                         */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, '..', 'noisefield.html'), 'utf8');

function core(){
  const a = HTML.indexOf('/* ==== logo-core:start');
  const b = HTML.indexOf('/* ==== logo-core:end');
  if (a < 0 || b < a) throw new Error('в noisefield.html не найден блок logo-core');
  return new Function(HTML.slice(a, b) + '\nreturn { LOGO, LG, lgSD, lgRest };')();
}
const C = core();

/* ------------------------------------------------------------- PNG ------ */
function readPNG(file){
  const buf = readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 0, bd = 0; const idat = [];
  while (p < buf.length){
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR'){ w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9];
                          if (data[12]) throw new Error('interlaced PNG не поддерживается'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('нужен 8-битный PNG');
  const ch = { 0:1, 2:3, 4:2, 6:4 }[ct];
  if (!ch) throw new Error('палитровый PNG не поддерживается');
  const raw = inflateSync(Buffer.concat(idat)), stride = w*ch;
  const out = new Uint8Array(w*h*4), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++){
    const f = raw[y*(stride + 1)];
    for (let i = 0; i < stride; i++){
      const x = raw[y*(stride + 1) + 1 + i];
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
             v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
    for (let xx = 0; xx < w; xx++){
      const o = (y*w + xx)*4, s = xx*ch;
      if (ch === 1){ out[o] = out[o+1] = out[o+2] = cur[s]; out[o+3] = 255; }
      else if (ch === 2){ out[o] = out[o+1] = out[o+2] = cur[s]; out[o+3] = cur[s+1]; }
      else { out[o] = cur[s]; out[o+1] = cur[s+1]; out[o+2] = cur[s+2]; out[o+3] = ch === 4 ? cur[s+3] : 255; }
    }
    prev.set(cur);
  }
  return { w, h, px: out };
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b){ let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function writePNG(file, w, h, rgb){
  const raw = Buffer.alloc((w*3 + 1)*h);
  for (let y = 0; y < h; y++) for (let i = 0; i < w*3; i++) raw[y*(w*3 + 1) + 1 + i] = rgb[y*w*3 + i];
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ih),
                                     chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/* ------------------------------------------------------------ сверка ---- */
const IMG = readPNG(join(HERE, '..', 'ref', 'logo.png'));
const ink = new Uint8Array(IMG.w*IMG.h);
for (let i = 0; i < ink.length; i++){
  const o = i*4, a = IMG.px[o+3], l = (IMG.px[o] + IMG.px[o+1] + IMG.px[o+2])/3;
  ink[i] = a > 128 && l < 128 ? 1 : 0;
}

// Посадка картинки: центр и пикселей на единицу. Подгоняется вместе с LOGO.
const FIT = { cx: 626.2, cy: 611.33, s: 445.5 };

function compare(step, wantMap){
  let I = 0, U = 0;
  const parts = new Map();
  const map = wantMap ? new Uint8Array(IMG.w*IMG.h*3) : null;
  for (let py = 0; py < IMG.h; py += step){
    for (let px = 0; px < IMG.w; px += step){
      const x = (px + 0.5 - FIT.cx)/FIT.s, y = (FIT.cy - (py + 0.5))/FIT.s;
      const [d, id] = C.lgSD(x, y);
      const a = d < 0 ? 1 : 0, b = ink[py*IMG.w + px];
      if (a && b) I++;
      if (a || b) U++;
      if (Math.abs(d) < 0.08){
        let s = parts.get(id); if (!s){ s = { i:0, u:0 }; parts.set(id, s); }
        if (a && b) s.i++;
        if (a || b) s.u++;
      }
      if (map){
        const o = (py*IMG.w + px)*3;
        const c = a && b ? [70,70,78] : b ? [235,40,40] : a ? [40,110,255] : [250,250,250];
        map[o] = c[0]; map[o+1] = c[1]; map[o+2] = c[2];
      }
    }
  }
  return { iou: U ? I/U : 0, parts, map };
}

const NAMES = Object.fromEntries(Object.entries(C.LG).map(([k, v]) => [v, k.toLowerCase()]));
const arg = process.argv.slice(2);

if (arg.includes('--fit')){
  // Покоординатный спуск: каждое число толкаем на шаг в обе стороны и берём,
  // если IoU растёт. Шаг мельчает, когда толкать некуда.
  const keys = [];
  for (const [k, v] of Object.entries(C.LOGO)){
    if (Array.isArray(v)) v.forEach((_, i) => keys.push([C.LOGO, k, i]));
    else keys.push([C.LOGO, k, null]);
  }
  for (const k of ['cx', 'cy', 's']) keys.push([FIT, k, null]);
  const get = ([o, k, i]) => i == null ? o[k] : o[k][i];
  const set = ([o, k, i], v) => { if (i == null) o[k] = v; else o[k][i] = v; };
  let best = compare(3).iou, scale = 0.04;
  console.log('старт', best.toFixed(4));
  for (let round = 0; round < 40 && scale > 0.002; round++){
    let improved = false;
    for (const key of keys){
      const v0 = get(key), st = (key[0] === FIT ? (key[1] === 's' ? 4 : 2) : Math.max(Math.abs(v0), 0.02))*scale;
      for (const dir of [1, -1]){
        set(key, v0 + dir*st);
        const r = compare(3).iou;
        if (r > best + 1e-5){ best = r; improved = true; break; }
        set(key, v0);
      }
    }
    console.log('круг', round, 'шаг', scale.toFixed(4), 'IoU', best.toFixed(4));
    if (!improved) scale *= 0.5;
  }
  const r5 = v => +(+v).toFixed(4);
  const out = {};
  for (const [k, v] of Object.entries(C.LOGO)) out[k] = Array.isArray(v) ? v.map(r5) : r5(v);
  console.log('\nLOGO =', JSON.stringify(out).replace(/"(\w+)":/g, '$1:').replace(/,/g, ', '));
  console.log('посадка', JSON.stringify({ cx: r5(FIT.cx), cy: r5(FIT.cy), s: r5(FIT.s) }));
}

const R = compare(1, arg.includes('--png'));
console.log(`\nIoU знака: ${R.iou.toFixed(4)}   (порог 0.95)`);
const rows = [...R.parts.entries()].sort((a, b) => a[0] - b[0]);
for (const [id, s] of rows) if (s.u > 200)
  console.log(`  ${(NAMES[id] || id).padEnd(10)} ${(s.i/s.u).toFixed(3)}`);
const pi = arg.indexOf('--png');
if (pi >= 0){
  const file = arg[pi + 1] || 'logo-diff.png';
  writePNG(file, IMG.w, IMG.h, R.map);
  console.log('карта расхождений:', file);
}
process.exitCode = R.iou >= 0.95 ? 0 : 1;
