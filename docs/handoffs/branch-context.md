# Снимок передачи ветки

> Создан командой `npm run handoff`. Снимок фиксирует Git metadata и имена путей; исходный diff,
> значения env, credentials, содержимое БД и файлы локальных инструментов не читаются.

## Состояние Git на момент генерации

- Ветка: `feat/app`
- HEAD: `5f063c10c320`
- Upstream: upstream не настроен локально
- Сгенерированный файл намеренно исключён из списка ниже, чтобы не ссылаться на собственную запись.

### Staged

- `A ` `.agents/skills/backend-http/SKILL.md`
- `A ` `.agents/skills/docker/SKILL.md`
- `A ` `.agents/skills/postgres/SKILL.md`
- `A ` `.agents/skills/security-review/SKILL.md`
- `A ` `.agents/skills/system-design/SKILL.md`
- `A ` `.agents/skills/testing-debugging/SKILL.md`
- `A ` `AGENTS.md`
- `M ` `README.md`
- `M ` `apps/api/README.md`
- `M ` `brand-spec.md`
- `A ` `docs/agent-workflows.md`
- `M ` `docs/app-stability-analysis.md`
- `A ` `docs/assets.md`
- `A ` `docs/data-and-idempotency.md`
- `A ` `docs/environments.md`
- `A ` `docs/handoff-guide.md`
- `A ` `docs/index.md`
- `A ` `docs/project-guide.md`
- `A ` `docs/prompt-analysis.md`
- `A ` `docs/review-baseline.md`
- `A ` `docs/user-stories.md`
- `A ` `docs/world-map-architecture.md`
- `A ` `docs/world-map-database.md`
- `A ` `docs/world-map-pki.md`
- `A ` `docs/world-map-spec.md`
- `M ` `package.json`
- `A ` `tools/context-handoff.mjs`

### Изменены, но не staged

- ` M` `.dockerignore`
- ` M` `.env.example`
- ` M` `.gitignore`
- ` M` `Dockerfile`
- ` M` `apps/api/.env.example`
- ` M` `apps/api/src/app.ts`
- ` M` `apps/api/src/auth/auth.repository.ts`
- ` M` `apps/api/src/auth/auth.service.ts`
- ` M` `apps/api/src/auth/telegram-init-data.ts`
- ` M` `apps/api/src/config.ts`
- ` M` `apps/api/src/observability/error-handler.ts`
- ` M` `bot/.env.example`
- ` M` `bot/bot.js`
- ` M` `docker-compose.yml`
- ` M` `docker/config.js.template`
- ` M` `docker/nginx.conf`
- ` M` `index.html`
- ` M` `legacy/index.landing.html`
- ` D` `logo.svg`
- ` M` `packages/contracts/src/index.ts`
- ` M` `registration.js`
- ` M` `tests/serve.mjs`

### Не отслеживаются Git

- `??` `apps/api/src/auth/auth.models.ts`
- `??` `assets/brand/logo.svg`
- `??` `assets/js/data/client-state-repository.js`
- `??` `assets/js/data/entities.js`
- `??` `docker/Caddyfile.example`
- `??` `docker/bootstrap.html`
- `??` `docker/bootstrap.js`
- `??` `docker/dev.env.example`
- `??` `docker/prod.env.example`
- `??` `tests/auth.test.mjs`
- `??` `tests/bootstrap.test.mjs`
- `??` `tests/client-state.test.mjs`
- `??` `tests/e2e/auth.spec.mjs`
- `??` `tests/environment.bot.test.mjs`
- `??` `tests/registration.test.mjs`

Локальные настройки, резервные копии или потенциально секретные пути пропущены: 14 (staged 1, unstaged 0, untracked 13). Их имена и содержимое не включены. Перед commit проверьте обычный `git status`.

Все обязательные контекстные документы уже отслеживаются Git.

## Как продолжить

1. Начните с [правил репозитория](../../AGENTS.md), [индекса документации](../index.md) и [карты проекта](../project-guide.md).
2. Используйте [обзор базового приложения](../review-baseline.md) как запись выполненного review; проверьте его ограничения перед релизными выводами.
3. Прочитайте [handoff guide](../handoff-guide.md). Он указывает, какие файлы намеренно не входят в перенос.
4. Этот отчёт сам не добавляет файлы в Git. Сверьте status, выберите изменения, затем вручную stage/review/commit/push.
