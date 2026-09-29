---
name: beta-config-03-remove-write-path
description: "Пункт 3 ТЗ: убрать API изменения беты и соответствующий UI-контрол, оставить чтение настройки для /api/state, переключив источник на серверный модуль."
---

# Скилл 03 — убрать API и UI изменения беты

**Запуск:** «выполни скилл `beta-config-03-remove-write-path`». **Требует:** решение B, готовый модуль из `.agents/skills/beta-config-01-server-module/SKILL.md`; `.agents/skills/beta-config-02-capture-values/SKILL.md` завершён или явно отложен до деплоя. **Меняет:** `bot/bot.js`, `bot/storage.js`, `index.html`, `config.js`, `docker/config.js.template`, тесты, документацию. Таблицу `beta_settings` **не удаляет** — это `.agents/skills/beta-config-04-drop-migration/SKILL.md`; после этого скилла она остаётся неиспользуемой.

## Цель

ТЗ, п. 3: убрать API изменения беты и соответствующий UI-контрол; оставить чтение настройки для `/api/state`. После скилла источник значения — серверный модуль, а не БД и не публичный `config.js`.

## Предусловия

**Стоп-условия:**
- Нет модуля `bot/beta-config.js` или его тестов не зелёные.
- Ветка не `feat/app` (или потомок `ea5c530`); чужие несохранённые изменения в затрагиваемых файлах.
- В `bot/` уже нет обращений к `beta_settings` (кто-то сделал часть работы) — сверить с `git log`, не дублировать.

Найти все точки касания (только чтение):

```bash
grep -rn "beta_settings\|setBeta\|STORE\.beta\|admin/beta\|betaToggle\|betaInitialization" --exclude-dir=node_modules --exclude-dir=.git .
grep -n "data-adm=\"fog\"\|fogsw\|adm__fog\|Туман · что открыто" index.html
grep -n "betaOpen" index.html config.js docker/config.js.template
```

## Шаги

### Сервер

1. `bot/bot.js`, `/api/state`: вместо `STORE ? await STORE.beta(betaOpen) : betaOpen` отдавать значение модуля. Формат ответа прежний — массив целых по возрастанию.
2. `bot/bot.js`, `/api/admin/overview`: ключ `betaOpen` в ответе **оставить** (чтение), но брать из модуля. Осторожно: `PostgresBotStore.overview(defaultOpen)` внутри сам вызывает `this.beta()` — перенести подстановку `betaOpen` в обработчик, а из `overview()` убрать обращение к таблице.
3. `bot/bot.js`: удалить обработчик `POST /api/admin/beta`.
4. `bot/bot.js`, запуск: удалить `await STORE.beta(betaOpen)` после `STORE.ready()` — бот больше не создаёт и не читает строку. Включить `required` для непустого `APP_ENV` (решение D4 из скилла 01): в dev и prod пустой `BETA_OPEN` — ошибка запуска с понятным сообщением.
5. `bot/storage.js`: удалить `beta()`, `setBeta()`, поле `betaInitialization`. Убрать `parseList`, если он больше нигде не нужен.
6. Права доступа не менять: `auth`, `adminAuth`, `QA_ENABLED`, `ADMIN_TG_IDS`, `DEV_ALLOWED_TG_IDS` остаются как есть; `/api/admin/overview` и `/api/admin/tester` работают по тем же правилам.

### Клиент (`index.html`)

7. Удалить функцию `betaToggle()`, ветку `if(act === 'fog'){ … }` в обработчике кликов панели, построение `fogGrid` и секцию «Туман · что открыто в бете». Удалить стили `.adm__fog` и `.fogsw*`, если они больше нигде не используются.
8. Оставить приём `betaOpen` из `/api/state` в `applyServerState` и кэш `rizzoma_beta` (`saveBetaOpen`): это чтение. `betaSync()` может по-прежнему брать список из `/api/admin/overview`.
9. Убрать клиентское переопределение: значение `betaOpen:null` в объекте `CFG` по умолчанию, ветку `Array.isArray(CFG.betaOpen) ? CFG.betaOpen : ECON.BETA_OPEN` (оставить только `ECON.BETA_OPEN` как запасное значение до ответа сервера), строку `betaOpen: null` в `config.js` и `docker/config.js.template`. Публичный конфиг перестаёт быть источником беты.
10. Проверить первый кадр: пока `/api/state` не ответил, показывается последний кэш `rizzoma_beta`, а при его отсутствии — `ECON.BETA_OPEN`. Если значение контура отличается от умолчания, на холодном старте туман кратко покажет неверное состояние. Оценить это на замедленном ответе API и доложить в отчёте — не «чинить» молча.

### Тесты

11. `tests/e2e/beta.spec.mjs`:
    - тест «туман правится из панели на лету» удалить или заменить проверкой, что `[data-adm="fog"]` отсутствует;
    - тест «администратор из списка панель открывает» проверяет текст «Туман» — он исчезнет вместе с секцией; обновить ожидание;
    - лишнее поле `betaOpen: null` в конфиге `tests/e2e/helpers.mjs` убрать.
12. API-тесты по образцу `tests/environment.bot.test.mjs` (дополнив заглушку сервиса регистрации): `POST /api/admin/beta` — 404 и для админа, и для остальных; `/api/state` возвращает список модуля; значение `betaOpen` в публичном `config.js` на ответ не влияет.
13. Не трогать `tests/economy.test.mjs` («туман правится списком» проверяет чистые функции с явным списком) и `tests/client-state.test.mjs` (`saveBetaOpen` остаётся).

### Документация

14. README: строка `BETA_OPEN` в таблице переменных («только при первом создании настроек в БД» → «список открытых узлов контура, проверяется при запуске, меняется деплоем»); абзац «задаётся в трёх местах…» и фраза «из бета-админки туман правится на лету, без деплоя»; строка `/api/admin/beta` в таблице API; строка «Туман» в таблице админки; `betaOpen` в примере `config.js`.
15. Комментарии `BETA_OPEN` в `.env.example`, `bot/.env.example`, `docker/dev.env.example`, `docker/prod.env.example`: значение обязательно для dev и prod и меняется деплоем.
16. Документацию о **схеме** (`docs/data-and-idempotency.md`, `docs/project-guide.md`) пока не менять — таблица ещё существует; её обновляет скилл 04.

## Проверки

```bash
node --test tests/beta-config.test.mjs tests/environment.bot.test.mjs tests/engagement.bot.test.mjs tests/client-state.test.mjs tests/economy.test.mjs
npx playwright test tests/e2e/beta.spec.mjs
npm test
grep -rn "beta_settings\|setBeta\|STORE\.beta\|admin/beta\|betaToggle" --exclude-dir=node_modules --exclude-dir=.git .
```

Последний `grep` должен показать только неизменяемую миграцию `002` и документы о схеме. Реальный Telegram и контуры этим скиллом не проверяются.

## Отчёт

Список изменённых файлов; удалённые маршруты, функции и стили; результаты проверок; замечание про первый кадр (шаг 10); ограничения: таблица `beta_settings` осталась, контуры не запускались.

## Чего не делать

- Не удалять таблицу и не создавать миграции.
- Не менять авторизацию, allowlist, `QA_ENABLED`, `ADMIN_TG_IDS`.
- Не удалять `/api/admin/overview` и чтение `betaOpen` — ТЗ требует оставить чтение.
- Не класть список беты ни в `config.js`, ни в другой публичный файл.
- Не печатать env; не выкладывать в контур — выкладка идёт по `.agents/skills/beta-config-runbook/SKILL.md`.

## Проектные skills

`backend-http` (маршруты), затем `system-design` (если меняется граница чтения) и `security-review` (убран путь записи — убедиться, что права не сдвинулись).
