# Окружения и деплой

Как устроены окружения RIZZOMA, как выкатывать изменения, где смотреть, что выкатилось,
и что делать, если что-то пошло не так. Всё повседневное видно в GitHub — на сервер ходить не нужно.

## Коротко

- Три окружения, у каждой ветки своё. Пуш в ветку — через 5–7 минут новая версия на её адресе.
- Выкатывается только то, что прошло тесты. Красные тесты — окружение остаётся на прошлой версии.
- Что сейчас где выкачено — блок **Deployments** справа на [главной странице репозитория](https://github.com/Rizzoma26/rizzoma).

| Ветка | Окружение | Адрес | Бот | Мини-аппа |
|---|---|---|---|---|
| `main` | prod | https://rizzoma.ru/ | [@rizzoma_bot](https://t.me/rizzoma_bot) | https://t.me/rizzoma_bot/app |
| `qa` | qa | https://qa.rizzoma.ru/ | [@rizzomaraveqa_bot](https://t.me/rizzomaraveqa_bot) | https://t.me/rizzomaraveqa_bot/rizzomaraveqa |
| `dev` | dev | https://dev.rizzoma.ru/ | [@rizzomarave_bot](https://t.me/rizzomarave_bot) | https://t.me/rizzomarave_bot/rizzomaravedev |

Остальные ветки (`feature/…` и т.п.) только тестируются, никуда не выкатываются.

В каждом боте `/start` присылает кнопку «Открыть RIZZOMA»; та же кнопка стоит в меню слева
от поля ввода.

## Как выкатывать

Обычный путь изменения — снизу вверх:

```
feature/… ──PR──▶ dev ──PR──▶ qa ──PR──▶ main
                  dev.        qa.        rizzoma.ru
```

1. Работаешь в своей ветке, открываешь PR в `dev`. На PR гоняются тесты — видно прямо в PR.
2. Мёрж в `dev` — через несколько минут изменения на `dev.rizzoma.ru` и в @rizzomarave_bot.
3. Проверили на dev — PR `dev` → `qa`, там проверяют тестеры.
4. Всё хорошо — PR `qa` → `main`, это выкатка в прод.

Срочный фикс можно пушить сразу в нужную ветку — выкатится так же. Потом донести его в
нижние ветки (`qa`, `dev`), чтобы они не разъехались с продом.

**Выкатить заново без нового коммита** (например, после правки настроек на сервере):
Actions → **deploy** → *Run workflow* → выбрать ветку.

## Где смотреть

Всё в GitHub:

| Что хочу узнать | Где |
|---|---|
| Что сейчас выкачено в prod / qa / dev и куда ведёт | главная страница репозитория → блок **Deployments** справа (или вкладка [Environments](https://github.com/Rizzoma26/rizzoma/deployments)) |
| Доехал ли мой коммит | **Actions** → прогон **deploy** с этим коммитом. Внизу прогона — табличка: окружение, адрес, коммит |
| Почему не доехал | там же: какой шаг красный — тесты (`tests`), сборка (`build`) или выкатка (`deploy`); лог шага объясняет |
| Прошли ли тесты в PR | вкладка **Checks** у PR |
| Общее состояние | значки вверху README |

## Что происходит после пуша

```
push ─▶ tests ─▶ build ─▶ deploy ─▶ проверка /health
        юнит     образы    сервер     сайт окружения
        + e2e    в GHCR    подтянул   отвечает
```

1. **tests** (`.github/workflows/ci.yml`) — юнит-тесты, интеграционные тесты бота, e2e на Playwright,
   проверка, что в репозиторий не попал токен. Гоняется на любой пуш и PR.
2. **deploy** (`.github/workflows/deploy.yml`) — только после зелёного `tests` и только для
   `main`/`qa`/`dev`:
   - **build** собирает три образа и пушит в `ghcr.io/rizzoma26` с тегами коммита и ветки:
     `rizzoma-bot` (бот + API), `rizzoma-web` (статика), `rizzoma-proxy` (общий вход с HTTPS);
   - **deploy** заходит на сервер по SSH и выкатывает окружение на этот коммит
     (`docker compose pull && up -d`), затем ждёт, пока `https://<адрес>/health` ответит.
     Прокси (домены, HTTPS) обновляется только вместе с `main`.

PR из форков не собираются и не выкатываются — их код не должен попасть на сервер.

## Настройки окружений

Всё, что отличается между окружениями и не должно лежать в git, — на сервере в `/opt/rizzoma`.
Это единственное, ради чего на сервер приходится заходить.

| Путь | Что там | Как применить правку |
|---|---|---|
| `prod/.env`, `qa/.env`, `dev/.env` | токен бота, цены, `PROVIDER_TOKEN`, `ADMIN_TG_IDS`, `CHANNEL_ID`… (см. `bot/.env.example`) | `cd /opt/rizzoma/<env> && docker compose up -d --force-recreate bot` |
| `<env>/public/config.js` | клиентский конфиг: `bot`, `app`, `apiBase`, цены, событие, `admins` | ничего — отдаётся сразу, без пересборки |
| `proxy/.env` | домены и токен Timeweb для сертификата | `cd /opt/rizzoma/proxy && docker compose up -d --force-recreate caddy` |

Важно:
- `docker compose restart` **не перечитывает** `.env` — только `up -d --force-recreate`.
- Цены живут в двух местах: `PRICE_STD`/`PRICE_VIP` в `.env` (их считает сервер, они попадают в
  счёт) и `prices` в `config.js` (только показ). Менять оба.
- Список админов беты — тоже в двух местах: `ADMIN_TG_IDS` в `.env` (решает доступ) и `admins` в
  `config.js` (подсказка интерфейсу).
- Выкатка эти файлы не трогает: правки на сервере не затираются.

## Откат

**Нормальный путь** — `git revert` плохого коммита и пуш в ту же ветку. Через 5–7 минут
откат на сервере, история чистая, в Deployments видно.

**Срочно, пока revert едет** — Actions → прогон **deploy** того коммита, на который надо
вернуться → *Re-run jobs* → **deploy**. Образы старых коммитов лежат в GHCR, сборка не нужна.

## Частые вопросы

**Запушил, а на сайте старое.** Actions → прогон **deploy** твоего коммита: если его нет —
тесты красные (смотри прогон **tests**); если он есть — смотри, какой шаг упал. Всё зелёное —
обнови страницу без кэша; мини-аппу в Telegram иногда надо закрыть и открыть заново.

**Данные пропали после выкатки.** Бэкенд хранит пользователей и оплаты в памяти — любой
перезапуск бота (а выкатка — это перезапуск) их стирает. Так написан `bot/bot.js`; для боя
нужно хранилище (Postgres/Redis).

**Один токен — один бот.** Нельзя запускать один и тот же `BOT_TOKEN` в двух местах (два
окружения, два сервера, локально + сервер): Telegram отдаёт обновления только одному, второй
получает 409. Для локальной разработки — свой отдельный бот.

**Логи бота / перезапуск** (на сервере): `docker logs -f prod-bot-1` (или `qa-bot-1`, `dev-bot-1`);
`cd /opt/rizzoma/<env> && docker compose restart bot`.

## HTTPS

Один wildcard-сертификат Let's Encrypt на `rizzoma.ru` и `*.rizzoma.ru` — покрывает все три
окружения. Выпускает и продлевает lego через DNS-API Timeweb (домен там), без участия людей:
`rizzoma-certs.timer` на сервере дважды в день проверяет и продлевает за 30 дней до истечения.
Срок видно в браузере (замочек → сертификат).

На сервере: `journalctl -u rizzoma-certs` — лог продления;
`openssl x509 -in /opt/rizzoma/proxy/certs/certificates/rizzoma.ru.crt -noout -enddate` — срок.

DNS Timeweb публикует изменения по несколько минут и вразнобой на разных NS, поэтому lego
ждёт фиксированные 10 минут перед проверкой — выпуск занимает ~12 минут, это нормально.

## Сервер

| | |
|---|---|
| Адрес | `192.145.30.168` (Стокгольм) |
| Вход | `ssh root@192.145.30.168`, только по SSH-ключу — пароли отключены |
| Свой ключ добавить | попросить того, у кого есть доступ, дописать публичный ключ в `/root/.ssh/authorized_keys` |
| Выкатка | GitHub Actions заходит как `deploy` ключом, который умеет только `rizzoma-deploy.sh <env> <sha>` (`/home/deploy/.ssh/authorized_keys`) |
| Образы | `ghcr.io/rizzoma26/*` — приватные; сервер логинится токеном `read:packages` (`/home/deploy/.docker/config.json`) |
| DNS | Timeweb: A-записи `@` и `*` у `rizzoma.ru` → IP сервера |

Настройки репозитория для выкатки: secret `DEPLOY_SSH_KEY`, variables `DEPLOY_HOST`,
`DEPLOY_KNOWN_HOSTS` (Settings → Secrets and variables → Actions).

Скрипты и юниты на сервере — копии из `deploy/server/`. Сами они при выкатке **не обновляются**
(деплой не должен переписывать сам себя): поменял что-то в `deploy/server/` — поставь руками,
проще всего повторным `bash install.sh` (см. ниже), он ничего настроенного не затирает.

Если GitHub по какой-то причине не может зайти на сервер, выкатить руками на сервере:
`systemctl start rizzoma-deploy` (все окружения на головы веток), лог — `journalctl -u rizzoma-deploy`.

### Токены, у которых есть срок жизни

| Что | Где | Если истечёт |
|---|---|---|
| GitHub classic PAT `read:packages` | `/home/deploy/.docker/config.json` | выкатка упадёт на шаге deploy с ошибкой доступа к GHCR. Перелогиниться: `sudo -u deploy docker login ghcr.io -u <логин>` |
| Токен Timeweb | `/opt/rizzoma/proxy/.env` | сертификат перестанет продлеваться |
| Токены ботов | `/opt/rizzoma/<env>/.env` | бот окружения перестанет отвечать |

PAT сейчас выпущен от личного аккаунта — если его владельца уберут из организации Rizzoma26,
выкатки сломаются. Лучше перевыпустить от отдельного сервисного аккаунта.

## Бэкап и переезд

Всё, что не в git (токены, `config.js` окружений, сертификат, вход в GHCR, SSH-ключи, ключ CI),
снимается одним архивом, новый сервер поднимается одним скриптом.

**Бэкап** (с локальной машины; в архиве секреты — хранить соответственно):
```bash
ssh root@192.145.30.168 /opt/rizzoma/bin/rizzoma-backup.sh > rizzoma-backup-$(date +%F).tgz
```
Снимать заново после любой смены токенов, `config.js` или ключей.

**Переезд на новый сервер** (Ubuntu 24.04, от 2 ГБ RAM, вход по ключу под root):

1. Скопировать установщик и бэкап:
   ```bash
   scp deploy/server/install.sh rizzoma-backup-*.tgz root@НОВЫЙ_IP:/root/
   ```
2. Установка без запуска — Docker, пользователь `deploy` с ключом CI, `/opt/rizzoma`, таймер
   сертификатов, запрет паролей, секреты из бэкапа:
   ```bash
   ssh root@НОВЫЙ_IP 'bash /root/install.sh --restore /root/rizzoma-backup-*.tgz'
   ```
3. Погасить старый сервер — два бота на одном токене мешают друг другу:
   ```bash
   ssh root@СТАРЫЙ_IP 'systemctl disable --now rizzoma-certs.timer; for d in prod qa dev proxy; do (cd /opt/rizzoma/$d && docker compose down); done'
   ```
4. Запустить новый — выкатит текущие коммиты `main`/`qa`/`dev`:
   ```bash
   ssh root@НОВЫЙ_IP 'bash /root/install.sh --start'
   ```
5. В репозитории поменять variables `DEPLOY_HOST` и `DEPLOY_KNOWN_HOSTS` на новый сервер
   (`ssh-keyscan -t ed25519 НОВЫЙ_IP`).
6. В Timeweb перевести A-записи `@` и `*` у `rizzoma.ru` на новый IP (TTL 600).
   Адреса не меняются — в @BotFather и `config.js` ничего править не нужно.
7. Проверить `https://rizzoma.ru/health`, `qa.`, `dev.`, `/start` в каждом боте и *Run workflow*
   у **deploy** — должен пройти. Удалить с нового сервера `/root/install.sh` и архив.

Без бэкапа `install.sh` создаст шаблоны `.env`/`config.js` и перечислит, что вписать руками
(включая ключ CI: новый ключ — `ssh-keygen -t ed25519`, публичную часть — в
`/home/deploy/.ssh/authorized_keys` с префиксом
`command="/opt/rizzoma/bin/rizzoma-deploy.sh --ssh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty `,
приватную — в secret `DEPLOY_SSH_KEY`).

## Новое окружение или новый домен

- **Ещё одно окружение** (скажем, `stage`): ветка в `on.workflow_run.branches` и в картах
  `STACK`/`URL`/`environment` в `deploy.yml`, `stage` в проверке `--ssh` и в `branch_of` в
  `deploy/server/rizzoma-deploy.sh`, блок `{$STAGE_DOMAIN}` в `deploy/proxy/Caddyfile`, каталог
  `/opt/rizzoma/stage` с `.env` и `public/config.js` на сервере, `STAGE_DOMAIN` в `proxy/.env`.
  Поддомен `stage.rizzoma.ru` уже покрыт wildcard-записью и сертификатом.
- **Свой бот** под окружение — @BotFather: `/newbot`, `/newapp` (Web App URL — адрес окружения,
  обложка 640×360), кнопка меню — Bot Settings → Menu Button. Токен — в `.env` окружения,
  `bot`/`app` — в его `config.js`.
