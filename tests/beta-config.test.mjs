/* Серверный модуль конфигурации беты: строгий разбор BETA_OPEN.
   Чистые функции — ни сети, ни БД, ни bot.js. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseBetaOpen, loadBetaConfig} from '../bot/beta-config.js';

const ECON = createRequire(import.meta.url)('../economy.js');
const N = ECON.TIERS.length;
const opts = {tierCount: N, defaultOpen: ECON.BETA_OPEN};

test('корректный список: по возрастанию, пробелы вокруг элементов допустимы', () => {
  assert.deepEqual(parseBetaOpen('0,1,3,4', {tierCount:N}), {ok:true, open:[0,1,3,4]});
  assert.deepEqual(parseBetaOpen(' 4 , 0,3 ,1 ', {tierCount:N}), {ok:true, open:[0,1,3,4]});
  assert.deepEqual(parseBetaOpen(String(N - 1), {tierCount:N}), {ok:true, open:[N - 1]});
});

test('неверный элемент — ошибка с именем переменной, элементом и диапазоном', () => {
  const cases = [
    ['abc', '«abc»'], ['0,abc', '«abc»'], ['-1', '«-1»'], ['1.5', '«1.5»'],
    [String(N), `«${N}»`], ['0,,1', 'пустой'], [',', 'пустой'], ['1,1', 'повтор'], ['0, 3,3', 'повтор']
  ];
  for(const [raw, detail] of cases){
    const r = parseBetaOpen(raw, {tierCount:N});
    assert.equal(r.ok, false, raw);
    assert.match(r.error, /BETA_OPEN/, raw);
    assert.ok(r.error.includes(detail), `${raw}: ${r.error}`);
    assert.ok(r.error.includes(`0…${N - 1}`), `${raw}: диапазон в сообщении`);
  }
});

test('первый плохой элемент назван по позиции', () => {
  const r = parseBetaOpen('0,1,x,y', {tierCount:N});
  assert.match(r.error, /№3 «x»/);
});

test('длинное значение не попадает в текст ошибки целиком', () => {
  const junk = '123456:AAsecret-looking-value-from-a-wrong-paste';
  const r = parseBetaOpen('0,' + junk, {tierCount:N});
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes('secret'), r.error);
  assert.match(r.error, /№2/);
});

test('пустая переменная: ошибка при required, значение economy.js без него', () => {
  for(const raw of [undefined, '', '   ']){
    const strict = loadBetaConfig({BETA_OPEN: raw}, {...opts, required:true});
    assert.equal(strict.ok, false);
    assert.match(strict.error, /BETA_OPEN не задан/);

    const loose = loadBetaConfig({BETA_OPEN: raw}, {...opts, required:false});
    assert.deepEqual([...loose.open], ECON.BETA_OPEN);
    assert.equal(loose.source, 'default');
  }
});

test('заданная переменная перекрывает значение по умолчанию и не мутируется', () => {
  const r = loadBetaConfig({BETA_OPEN:'2,0'}, {...opts, required:true});
  assert.deepEqual({ok:r.ok, open:[...r.open], source:r.source}, {ok:true, open:[0,2], source:'env'});
  assert.ok(Object.isFrozen(r.open));
  assert.deepEqual(ECON.BETA_OPEN, [0,1,3,4]);
});

test('ошибка не содержит значений других переменных окружения', () => {
  const env = {BETA_OPEN:'0,9x', BOT_TOKEN:'424242:synthetic', DATABASE_URL:'postgresql://u:p@db/x'};
  const r = loadBetaConfig(env, {...opts, required:true});
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes('424242') && !r.error.includes('postgresql'), r.error);
});
