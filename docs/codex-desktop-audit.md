# Аудит Codex Desktop для Rizzoma — 2026-09-28

Это датированный аудит настроек конкретной рабочей среды, а не источник текущей архитектуры
или правил работы. Портативные инструкции находятся в `AGENTS.md` и `docs/agent-workflows.md`;
текущее состояние приложения — в `docs/project-guide.md` и `docs/review-baseline.md`. В документе
и связанном JSON есть абсолютные пути и детали локального окружения; очистите их перед переносом
в общий Git, иначе оставьте эти audit-артефакты только на машине автора.

Область: только `/Users/gruber/WebstormProjects/rizzoma`. Код приложения и чужие незакоммиченные изменения не правились. Глобальный config сохранён побайтно; проект общих интеграций не изменялся и после уточнения пользователя исключён из дальнейших проверок.

| Компонент | Было | Стало | Причина |
|---|---|---|---|
| Plugins | 10 overrides; неверный Sites ID, отсутствовал unified-computer-use | 12 проверенных отключений; codex-app-tools не отключён | Убрать ненужные инструменты и plugin-skills |
| MCP / hosted apps | Наследовался node_repl; codex_apps отдавал Sites/Documents независимо от plugin overrides | node_repl disabled с настоящим транспортом; features.apps=false | Исключить отдельные каналы постоянной загрузки |
| Skills | 69 SKILL.md найдены в локальных каталогах и plugin cache | Metadata-аудит всех 69; app-server обнаруживает 24 локальных skills без ошибок | Не загружать инструкции всех skills; не импортировать Cursor |
| AGENTS.md | 7877 байт, дубли и устаревшее описание текущей реализации | 4036 байт, постоянные правила; редкие процедуры в agent-workflows.md | Уменьшить обязательный контекст на 49% по байтам |
| Knowledge | Два существующих ТЗ Rizzoma | Точечный Wiki-поиск сохранён; добавлена выжимка этого ТЗ | Требования доступны без MCP и полного обхода vault |
| Reasoning | Наследовался global high | Проектный medium; модель не менялась | High выбирается для сложных задач |

## Наблюдаемое и противоречия

- **Наблюдается:** до изменений пустых корпоративных MCP definitions в project config уже не было. Удалять их повторно не потребовалось; новые не создавались.
- **CONTRADICTION:** config ссылался на `sites@openai-bundled`, установленный manifest находится в `openai-curated-remote/sites`. Использован фактический ID.
- **CONTRADICTION:** прежний AGENTS.md утверждал публичную раздачу UI. Текущий незакоммиченный nginx уже содержит bootstrap и `auth_request`. Устаревшее утверждение убрано из AGENTS; это не подтверждение готового развёртывания. Старый раздел текущего состояния в environments.md также требует сверки с кодом при задаче по средам.
- Git remote указывает на github.com. Локальных признаков GitLab MR/issues/pipeline workflow не найдено; GitLab MCP не добавлялся. Удалённый Git не вызывался.
- codex-app-tools manifest описывает локальный MCP инструментов Desktop. Его отключение не выполнялось. Hosted `codex_apps` — другой канал.

## Проверки и ограничения

- TOML успешно разбирается Python; все 12 plugin IDs подтверждены локальными manifests/cache, исполняемый файл node_repl существует.
- Установленный `codex-cli 0.158.0-alpha.2.1`, app-server `config/read`: project layer включён, reasoning medium, 12 plugins disabled, features.apps=false, node_repl disabled. Корпоративные MCP отсутствуют.
- `skills/list`: 24 skills, 0 ошибок; wiki/wiki-query/wiki-retrieve доступны. 45 SKILL.md из plugin cache не равны 45 активным skills. Полные инструкции всех файлов не читались.
- `thread/start` с ephemeral=true: успешно, reasoning medium. Запрос к модели/turn не отправлялся; постоянный пользовательский чат не создавался. `mcpServerStatus/list` вернул лишь disabled node_repl с пустым tools; codex_apps после отключения отсутствует.
- Прямой старт app-server внутри sandbox не смог инициализироваться; read-only диагностика вне sandbox прошла. `--strict-config` у `features list` не поддерживается этой CLI, поэтому валидность подтверждена реальным app-server, а не этим флагом.
- Визуальная проверка Desktop заблокирована самим Computer Use: доступ к com.openai.codex запрещён. Полный критерий нового чата именно в UI остаётся непроверенным. Уже открытый чат может сохранять ранее выданные инструменты; проверяйте новую сессию проекта после перезапуска Desktop.
- Для окончательной UI-приёмки: открыть Rizzoma, убедиться в отсутствии `failed to load workspace requirements`/`invalid transport`, проверить Medium и отсутствие Browser/Computer Use/Sites/Documents/корпоративных MCP в новом чате. Явные настройки UI/хоста могут иметь приоритет над project default.
- Глобальный config совпал с исходным SHA-256; backups совпали с исходными файлами. Корпоративные подключения общего проекта не проверялись после уточнения границ пользователем. Нельзя заявлять об их доступности по результатам этой задачи.
- Секреты/env/auth.json не выводились. Ротация ранее раскрытого Jira token в эту задачу только по Rizzoma не входит.
- Тесты приложения не запускались: изменены только настройки и документация. Проверены TOML, реальные config/discovery/session APIs, локальные ссылки и diff.

## Skills

[Полный metadata-аудит](codex-skills-audit.json) содержит name, description, path, source, resolved_path и решение для каждой записи. Каталоги: 17 user skills в ~/.agents, 7 в ~/.codex, 0 project skills до изменений, 45 в plugin cache. Существующий Wiki workflow сохранён, дублирующий project skill не создан. Установленные Canvas/Bases и другие узкие user skills остаются только в metadata; не читать/вызывать их для обычной backend-задачи. Cursor skills не импортировались.

## Knowledge transaction

`ingest-20260928-rizzoma-codex`, inspect/apply успешно. Изменены только:

- `/Users/gruber/Knowledge/wiki/engineering/тз/rizzoma-оптимизация-codex-desktop.md`
- `/Users/gruber/Knowledge/wiki/engineering/тз/реестр-тз.md`
- `/Users/gruber/Knowledge/wiki/hot.md`
- `/Users/gruber/Knowledge/wiki/log.md`

Новая заметка ссылается на проект Rizzoma и регламенты тестирования; сырое вложение не копировалось.

## Финальный .codex/config.toml

```toml
# Rizzoma only. High for complex tasks; maximum effort only when needed.
model_reasoning_effort = "medium"

# Hosted connectors are opt-in for tasks that need live external data.
[features]
apps = false

# Legacy Browser/Computer Use runtime inherited from the user config.
# Keep a real transport in this layer; never add transport-less MCP stubs.
[mcp_servers.node_repl]
command = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"
args = []
enabled = false

[plugins."documents@openai-primary-runtime"]
enabled = false

[plugins."pdf@openai-primary-runtime"]
enabled = false

[plugins."spreadsheets@openai-primary-runtime"]
enabled = false

[plugins."presentations@openai-primary-runtime"]
enabled = false

[plugins."template-creator@openai-primary-runtime"]
enabled = false

[plugins."visualize@openai-bundled"]
enabled = false

[plugins."sites@openai-curated-remote"]
enabled = false

[plugins."browser@openai-bundled"]
enabled = false

[plugins."computer-use@openai-bundled"]
enabled = false

[plugins."unified-computer-use@openai-bundled"]
enabled = false

[plugins."superpowers@openai-curated"]
enabled = false

[plugins."openai-templates@openai-curated-remote"]
enabled = false
```

## Изменения AGENTS.md

```diff
--- AGENTS.md.bak
+++ AGENTS.md
@@ -1,38 +1,14 @@
-# Rizzoma: инструкции для агентов
+# Rizzoma: постоянные правила
 
-## Источники и границы
-
-- Работайте в текущей ветке и сохраняйте чужие незакоммиченные изменения. Перед правками проверяйте `git status` и фактический код.
-- Для задач по этому репозиторию сначала точечно читайте относящиеся к Rizzoma страницы `/Users/gruber/Knowledge/wiki/engineering/тз/`, затем сверяйте их с кодом. Не обходите весь vault и не переносите решения из других проектов. Если документация и код расходятся, явно помечайте противоречие.
-- Если задача приносит новое ТЗ, до реализации найдите и обновите каноническую краткую выжимку в vault через одну проверенную транзакцию; не сохраняйте туда секреты, историю чата и временный статус.
-- Rizzoma — личный проект, отдельный от работы. Не обращайтесь к рабочим Jira, Confluence, GitLab, Allure TestOps и другим корпоративным системам за требованиями, кодом или тестовыми данными. Не публикуйте туда материалы Rizzoma. Операции с удалённым Git выполняйте только по отдельному запросу пользователя.
-- На момент составления этих инструкций рабочая ветка `feat/app` — базовое приложение Rizzoma с PostgreSQL **без карты**. Проверяйте актуальную ветку перед работой. ТЗ FogMap — отдельный будущий контур; его SQLite-схему и UI нельзя молча переносить сюда.
-- За архитектурой и критериями двух сред обращайтесь к [`docs/environments.md`](docs/environments.md). В ней отдельно указаны текущее состояние и целевое, ещё не реализованное.
-
-## Целевая модель dev/prod
-
-- Один сервер, два HTTPS-домена, два независимых запуска одного приложения: `web + API + bot + PostgreSQL` для каждого. Домены и DNS пока не заданы; не подставляйте вымышленные реальные адреса.
-- У dev и prod разные Telegram-боты и `BOT_TOKEN`, секреты, БД, volumes, сети, сессии, настройки оплаты и каналы. Общими могут быть исходный код и проверенный образ сборки, но не состояние.
-- Вся функциональная и QA-проверка идёт на dev. Dev доступен только разрешённым Telegram-пользователям; тестовые режимы и платёжные настройки dev не должны попадать в prod.
-- Выпуск: та же проверенная сборка сначала в dev, затем после проверки и резервной копии — в prod. Миграции выполняются отдельно в каждой БД; применённые SQL-миграции не переписываются.
-
-## Доступ к Mini App
-
-- Цель — **только запуск как Telegram Mini App** через соответствующего бота. Открытие ссылки обычным браузером или встроенным браузером Telegram не даёт доступа к приложению.
-- Авторизация — только на сервере по подписанному `Telegram.WebApp.initData`, проверенному с токеном бота именно этого контура и с ограничением возраста данных. `initDataUnsafe`, `platform`, User-Agent, URL, CORS и скрытая кнопка не являются доказательством входа.
-- Первый HTTP-запрос не содержит `initData`. Допускается минимальная общедоступная стартовая оболочка для передачи подписанных данных серверу; основной интерфейс, персональные данные и все защищённые API доступны только после успешной проверки и создания сессии. Все запросы к защищённым ресурсам проверяют сессию.
-- Для dev дополнительно проверяйте серверный allowlist тестеров. Проверка на клиенте может только управлять отображением, но не предоставлять доступ.
-- Не отправляйте токены, `initData`, платёжные данные и секреты в логи, документацию, коммиты, сообщения другим чатам и браузерную конфигурацию. Храните реальные значения только в секретах сервера; раскрытые токены ротируйте до внешнего доступа.
-
-## Текущая реализация — не путать с целью
-
-- Сейчас `docker-compose.yml` задаёт один стек с фиксированным именем; два контура, домены и TLS-прокси ещё не настроены.
-- Сейчас `docker/nginx.conf` публично отдаёт `index.html`, а `index.html` поддерживает браузерный fallback. Наличие `registration.js` и проверка `initData` в API **не означают**, что сайт уже закрыт.
-- Структура БД задаётся `db/migrations/*.sql`, миграции применяет API. Начальную миграцию `001_identity.sql` и уже применённые миграции не меняйте задним числом.
-- Не объявляйте dev/prod или Telegram-only доступ готовыми без реализации, проверки двух ботов и отрицательной проверки входа из обычного браузера.
-
-## Проверка и выпуск
-
-- Сохраняйте существующие быстрые проверки и выполняйте соразмерную проверку изменённых частей. Генерацию новых больших наборов тестов и расширение тестовой инфраструктуры отложите до отдельного запроса.
-- Для закрытого входа проверьте положительный запуск из каждого Mini App и отказ обычному браузеру, встроенному браузеру Telegram, чужому/просроченному `initData`, токену другого контура и пользователю вне dev allowlist.
-- Без реальных доменов, DNS, TLS-сертификатов и серверного хранилища секретов можно готовить код и шаблоны, но нельзя заявлять о завершённом развёртывании на телефонах.
+- Работайте в текущей ветке; перед правками проверяйте `git status` и сохраняйте чужие изменения. Удалённый Git — только по отдельному запросу.
+- Rizzoma — личный проект. Не используйте корпоративные Jira, Confluence, GitLab и TestOps. Не меняйте глобальные настройки Codex ради проекта.
+- До инженерной работы точечно найдите относящиеся к задаче знания Rizzoma через существующий `wiki` skill в `/Users/gruber/.agents/skills/wiki`; затем сверьте код. Не читайте весь vault, все ТЗ или docs. Если знаний нет — сообщите; расхождения помечайте **CONTRADICTION**, разделяя наблюдаемое, документированное и предлагаемое.
+- Новое ТЗ до реализации оформляйте краткой канонической выжимкой в `/Users/gruber/Knowledge/wiki/engineering/тз/` через одну проверенную транзакцию; порядок поиска и записи — [Knowledge](docs/agent-workflows.md#knowledge).
+- Базовый контур: PostgreSQL, frontend `index.html`/`js`, API `apps/api`, bot `bot`, общие контракты `packages`. Проверяйте фактическую ветку и код; FogMap/SQLite — отдельный контур, не переносите его решения автоматически.
+- Схема БД — `db/migrations/*.sql`, миграции применяет API. Уже применённые SQL, включая `001_identity.sql`, не переписывайте; добавляйте новые версии.
+- Dev/prod изолированы по ботам, секретам, БД, volumes, сетям и сессиям; QA и тестовые платежи — только dev. Детали читайте лишь для задач по средам: [контуры](docs/environments.md).
+- Telegram Mini App авторизуется сервером по подписанному `initData` соответствующего бота с ограничением возраста; защищённые UI/API требуют сессию, dev — серверный allowlist. Клиентские признаки вход не доказывают.
+- Не выводите секреты, `*.env`, `auth.json`, токены, `initData` или платёжные данные. При диагностике показывайте только имена переменных и `<set>`/`<unset>`.
+- До завершения выполните соразмерные существующие проверки: `npm test`, `npm run typecheck`, `npm run build`; E2E — когда затронут соответствующий сценарий. Для документации/настроек проверяйте сами файлы. Большие новые наборы тестов — по отдельному запросу.
+- Skills выбирайте по metadata, полный SKILL.md читайте по соответствию задаче. Не импортируйте Cursor skills пакетно. Browser/Computer Use и внешние MCP нужны только конкретной задаче; перед визуальной проверкой сообщите о необходимой capability. Superpowers не является обязательным workflow.
+- Для deployment, security review и Telegram-debugging точечно читайте [редкие проверки](docs/agent-workflows.md#доступ-и-выпуск). Не объявляйте развёртывание готовым без реальной проверки.
```

Редкие процедуры: [agent-workflows.md](agent-workflows.md). Backups: `AGENTS.md.bak`, `.codex/config.toml.bak`. Для отката восстановите эти два файла из backups; дополнительные audit/reference файлы сами по себе не загружаются как инструкции.

## Официальные источники

- [Project plugin overrides](https://developers.openai.com/plugins/build/plugins)
- [Конфигурация: reasoning и features.apps](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Skills: metadata и progressive disclosure](https://learn.chatgpt.com/docs/build-skills)
