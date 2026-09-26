# Rizzoma registration API

Отдельный backend базового приложения. Он не содержит карту и не поддерживает
SQLite. Единственный источник серверных данных — PostgreSQL из `DATABASE_URL`.

## Контракт

- `POST /api/v1/registrations/telegram` — проверяет Telegram `initData`,
  идемпотентно создаёт пользователя и регистрацию, выдаёт короткую сессию;
- `POST /api/v1/registrations/bot` — тот же профиль из `/start`, запрос подписан
  HMAC на общем `BOT_TOKEN` и ограничен по времени;
- `GET /api/v1/me` — проверка короткого bearer token;
- `GET /health/live` — процесс работает;
- `GET /health/ready` — PostgreSQL отвечает.

В базе хранятся только хеши access token. Исходный `initData`, `BOT_TOKEN` и
подписи запросов не пишутся ни в таблицы, ни в журнал ошибок.

## Локально

```bash
cp apps/api/.env.example apps/api/.env
npm run db:migrate
npm run dev:api
```

API намеренно не запускается при недоступном PostgreSQL. Настройки пула и
таймаутов перечислены в `.env.example`.
