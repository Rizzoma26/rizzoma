/* Статические данные сцены: assets/generated/scene-data.js.
   1) закоммиченный файл свежий — генератор даёт ровно его;
   2) числа совпадают с прежним построением на лету (tests/fixtures/scene-baseline.json
      снят с кода index.html до выноса) с допуском округления 1e-6;
   3) в ресурсе нет ничего, что зависит от контура или пользователя: он
      кэшируется на устройстве между сессиями. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {render, scriptRef, OUTPUT, INDEX, SCRIPT_REF} from '../tools/build-scene-data.mjs';

const require = createRequire(import.meta.url);
const GEO = require('../assets/js/scene/geometry.js');
const ECON = require('../economy.js');
const committed = fs.readFileSync(OUTPUT, 'utf8');
/* файл выполняется как в браузере; JSON — чтобы объекты были из этого realm */
const scene = (() => { const ctx = {window:{}}; vm.runInNewContext(committed, ctx);
  return JSON.parse(JSON.stringify(ctx.window.RIZZOMA_SCENE)); })();
const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/scene-baseline.json', import.meta.url), 'utf8'));

test('закоммиченный scene-data.js свежий: npm run build:scene даёт ровно его', () => {
  assert.equal(committed, render(), 'ресурс устарел — выполнить npm run build:scene и закоммитить результат');
});

test('index.html ссылается на ресурс с хэшем текущего содержимого', () => {
  const html = fs.readFileSync(INDEX, 'utf8');
  const refs = html.match(SCRIPT_REF) || [];
  assert.deepEqual(refs, [scriptRef(committed)]);
});

test('version ресурса совпадает с тем, что ждёт страница', () => {
  assert.equal(scene.version, GEO.versionOf(ECON));
  // правка входов (ветви, названия скиллов) меняет version — страница посчитает сцену сама
  const other = {...ECON, BRANCHES: ECON.BRANCHES.map((b, k) => k ? b : {...b, idx:[...b.idx].reverse()})};
  assert.notEqual(GEO.versionOf(other), scene.version);
  const renamed = {...ECON, TIERS: ECON.TIERS.map((t, i) => i ? t : {...t, skill: t.skill + '!'})};
  assert.notEqual(GEO.versionOf(renamed), scene.version);
});

function assertClose(actual, expected, path = 'scene'){
  if(typeof expected === 'number'){
    assert.equal(typeof actual, 'number', path);
    assert.ok(Math.abs(actual - expected) <= 1e-6, `${path}: ${actual} vs ${expected}`);
    return;
  }
  if(Array.isArray(expected)){
    assert.ok(Array.isArray(actual), path);
    assert.equal(actual.length, expected.length, `${path}.length`);
    expected.forEach((v, k) => assertClose(actual[k], v, `${path}[${k}]`));
    return;
  }
  if(expected && typeof expected === 'object'){
    for(const k of Object.keys(expected)) assertClose(actual[k], expected[k], `${path}.${k}`);
    return;
  }
  assert.equal(actual, expected, path);
}

test('числа совпадают с прежним построением на лету (допуск 1e-6)', () => {
  const {source, version, ...expected} = baseline;
  assert.match(source, /index\.html@/);
  // клин, спина и облако зависят только от сидов — сверяются всегда
  for(const key of ['groups', 'spine', 'halo']) assertClose(scene[key], expected[key], key);
  assert.deepEqual(scene.groups.map(g => g.r), expected.groups.map(g => g.r));
  // узлы и сигилы зависят от BRANCHES и названий скиллов в economy.js:
  // после их правки база снята для других входов и здесь не применима
  if(version !== scene.version) return;
  for(const key of ['skills', 'extent']) assertClose(scene[key], expected[key], key);
  assert.deepEqual(scene.skills.map(s => [s.i, s.b, s.k, s.from, s.to]),
                   expected.skills.map(s => [s.i, s.b, s.k, s.from, s.to]));
  assert.deepEqual(scene.sigils, expected.sigils);
});

test('ресурс не зависит от контура и пользователя', () => {
  const allowed = new Set(['version', 'groups', 'spine', 'skills', 'extent', 'halo', 'sigils',
    'seg', 'dots', 'r', 'pts', 'polys', 'i', 'b', 'k', 'wx', 'wy', 'from', 'to', 'h', 'v', 's']);
  const strings = [];
  (function walk(v){
    if(typeof v === 'string') return strings.push(v);
    if(Array.isArray(v)) return v.forEach(walk);
    if(v && typeof v === 'object') for(const [k, x] of Object.entries(v)){ assert.ok(allowed.has(k), `ключ ${k}`); walk(x); }
  })(scene);
  // строки — только version и SVG-пути сигилов
  assert.deepEqual(strings.filter(s => !/^[ML0-9. -]+$/.test(s)), [scene.version]);
  assert.match(scene.version, /^[0-9a-f]{8}$/);
  for(const word of ['beta', 'price', 'http', 'token', 'apiBase', 'admin'])
    assert.ok(!committed.toLowerCase().includes(word.toLowerCase()), word);
  assert.equal(scene.sigils.length, ECON.TIERS.length);
});

test('запасной путь страницы считает те же числа, что лежат в ресурсе', () => {
  assert.deepEqual(GEO.build(ECON), scene);
});
