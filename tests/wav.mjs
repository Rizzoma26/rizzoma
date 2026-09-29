/* Синтетические треки в WAV — чтобы гонять в браузере то же, что меряют
   тесты.   node tests/wav.mjs   → tests/out/*.wav                          */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { musicScenes, SR } from './synth.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
musicScenes().forEach((s, i) => {
  const n = s.x.length, b = Buffer.alloc(44 + n*4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n*4, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR*4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n*4, 40);
  for (let k = 0; k < n; k++){
    const v = Math.max(-1, Math.min(1, s.x[k]))*32767 | 0;
    b.writeInt16LE(v, 44 + k*4); b.writeInt16LE(v, 46 + k*4);
  }
  const f = join(OUT, `music${i}.wav`);
  writeFileSync(f, b);
  console.log(f, '·', s.name, '· дропы', s.drops.map(t => t.toFixed(2)).join(' '));
});
