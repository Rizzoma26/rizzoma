/* ============================================================
   Конфигурация беты на сервере: какие узлы дерева открыты тестерам.

   Источник истины — переменная BETA_OPEN окружения контура (dev и prod
   держат свои env-файлы). Список меняется вместе с релизом: новое значение
   начинает действовать после пересоздания бота. Публичный config.js сюда
   не участвует — клиент получает список только из /api/state.

   Здесь только чистые функции: ни сети, ни БД, ни process.exit.
   Останавливает запуск bot.js, если loadBetaConfig вернул ok:false.
   ============================================================ */

/* Элемент показываем в ошибке, только если он короткий и похож на опечатку
   в числе. Длинное значение могло оказаться в BETA_OPEN по ошибке копипасты
   (например, токен) — его в логи не выводим, называем только позицию. */
const SHOWABLE = /^[\w.+ -]{1,12}$/;

function describe(item, position){
  if(!item) return `элемент №${position} пустой`;
  return SHOWABLE.test(item) ? `элемент №${position} «${item}»` : `элемент №${position}`;
}

/**
 * Строгий разбор списка открытых узлов.
 * Ошибка — нецелое, отрицательное, вне 0…tierCount-1, пустой элемент,
 * дубликат или пустой список. Результат — индексы по возрастанию.
 * @returns {{ok:true, open:number[]} | {ok:false, error:string}}
 */
export function parseBetaOpen(raw, {tierCount}){
  if(!Number.isInteger(tierCount) || tierCount < 1) throw new TypeError('tierCount must be a positive integer');
  const range = `ожидаются индексы узлов 0…${tierCount - 1} через запятую, например 0,1,3,4`;
  const text = String(raw ?? '').trim();
  if(!text) return {ok:false, error:`BETA_OPEN: список пуст — ${range}`};

  const seen = new Set();
  const items = text.split(',');
  for(let k = 0; k < items.length; k++){
    const item = items[k].trim();
    if(!/^\d+$/.test(item))
      return {ok:false, error:`BETA_OPEN: ${describe(item, k + 1)} — не целый неотрицательный индекс; ${range}`};
    const index = Number(item);
    if(index >= tierCount)
      return {ok:false, error:`BETA_OPEN: ${describe(item, k + 1)} — вне диапазона; ${range}`};
    if(seen.has(index))
      return {ok:false, error:`BETA_OPEN: ${describe(item, k + 1)} — повтор индекса ${index}; ${range}`};
    seen.add(index);
  }
  return {ok:true, open:[...seen].sort((a, b) => a - b)};
}

/**
 * Настройка беты из окружения.
 * required:true — переменная обязательна (dev и prod): без неё список контура
 * неизвестен, а подставлять значение по умолчанию значит молча открыть
 * тестерам не то. required:false — локальные тесты без контура: берётся
 * defaultOpen (BETA_OPEN из economy.js).
 * @returns {{ok:true, open:number[], source:'env'|'default'} | {ok:false, error:string}}
 */
export function loadBetaConfig(env, {tierCount, defaultOpen, required}){
  const raw = env ? env.BETA_OPEN : undefined;
  if(raw === undefined || String(raw).trim() === ''){
    if(required){
      return {ok:false, error:`BETA_OPEN не задан: для dev и prod список открытых узлов беты обязателен — ожидаются индексы узлов 0…${tierCount - 1} через запятую, например 0,1,3,4`};
    }
    const fallback = parseBetaOpen((defaultOpen || []).join(','), {tierCount});
    if(!fallback.ok) throw new Error('economy.js BETA_OPEN is invalid');
    return {ok:true, open:Object.freeze(fallback.open), source:'default'};
  }
  const parsed = parseBetaOpen(raw, {tierCount});
  return parsed.ok ? {ok:true, open:Object.freeze(parsed.open), source:'env'} : parsed;
}
