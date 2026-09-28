# Rizzoma registration API

Отдельный backend базового приложения. Он не содержит карту и не поддерживает
SQLite. Единственный источник серверных данных — PostgreSQL из `DATABASE_URL`.

## Контракт

- `POST /api/v1/registrations/telegram` — проверяет Telegram `initData`,
  идемпотентно создаёт пользователя и регистрацию, выдаёт короткую сессию в Secure HttpOnly host-only cookie, без токена в JSON;
- `POST /api/v1/registrations/bot` — тот же профиль из `/start`, запрос подписан
  HMAC на `BOT_TOKEN` своего контура и ограничен по времени;
- `GET /api/v1/me` — личность из серверной cookie-сессии;
- `GET /api/v1/session` — 204 для валидной сессии (nginx auth_request);
- `GET /health/live` — процесс работает;
- `GET /health/ready` — PostgreSQL отвечает.

Доменные типы пользователя и результата регистрации описаны отдельно в
[`src/auth/auth.models.ts`](src/auth/auth.models.ts); SQL row-типы и преобразование
строк остаются деталями `src/auth/auth.repository.ts`.

В базе хранятся только хеши access token. Исходный `initData`, `BOT_TOKEN` и
подписи запросов не пишутся ни в таблицы, ни в журнал ошибок.

## Схема и миграция

Вся начальная схема приложения находится в одном файле
`db/migrations/001_identity.sql`. SQL-файл одновременно является первой
миграцией; отдельной декларации моделей БД нет. Runner `src/db/migrate.ts`
создаёт только служебный журнал `schema_migrations`, проверяет контрольную
сумму и применяет SQL один раз в транзакции. После применения не меняйте этот
файл: новые изменения оформляются следующими нумерованными миграциями.
`db/migrations/002_persistent_bot_state.sql` добавляет транзакционное состояние
бота; бот и API используют одну PostgreSQL, а миграциями управляет только API.

## Локально

```bash
cp apps/api/.env.example apps/api/.env
npm run db:migrate
npm run dev:api
```

API намеренно не запускается при недоступном PostgreSQL. Настройки пула и
таймаутов перечислены в `.env.example`.

`APP_ENV` обязателен; для dev обязателен `DEV_ALLOWED_TG_IDS`. Разрешён один
точный HTTPS origin. Подробнее: [контуры и запуск](../../docs/environments.md).
