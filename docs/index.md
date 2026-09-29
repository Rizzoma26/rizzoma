# Индекс документации Rizzoma

Этот индекс разделяет текущие правила, факты кода, исторические источники и будущие проекты.
При расхождении сначала проверьте реализацию и миграции; фиксируйте **CONTRADICTION** между
наблюдаемым, документированным и предлагаемым состоянием.

## Текущая работа и передача контекста

- [`AGENTS.md`](../AGENTS.md) — обязательные правила репозитория и границы безопасности.
- [`handoff-guide.md`](handoff-guide.md) — что включать в Git и как собрать handoff ветки.
- [`handoffs/branch-context.md`](handoffs/branch-context.md) — сгенерированный снимок текущего Git-состояния; обновляется `npm run handoff`.
- [`README.md`](../README.md) — быстрый обзор, запуск и API продукта.
- [`project-guide.md`](project-guide.md) — текущие границы модулей, поток авторизации и источники истины.
- [`data-and-idempotency.md`](data-and-idempotency.md) — сущности, БД, клиентский кеш и повторные операции.
- [`environments.md`](environments.md) — изоляция dev/prod, целевой выпуск и фактически известные ограничения проверки.
- [`beta-config.md`](beta-config.md) — перенос настройки беты из `beta_settings` в env контура: решение, эффективные значения dev/prod, порядок выкладки и приёмка.
- [`agent-workflows.md`](agent-workflows.md) — локальные процедуры работы с возможностями Codex.

## Контракты и требования

- [`user-stories.md`](user-stories.md) — согласованные пользовательские сценарии и критерии приёмки базового приложения.
- [`prompt-analysis.md`](prompt-analysis.md) — сопоставление исходных промптов с текущим кодом.
- [`app-redesign-prompt.md`](../app-redesign-prompt.md), [`beta-launch-prompt.md`](../beta-launch-prompt.md) и [`telegram-engagement-prompt.md`](../telegram-engagement-prompt.md) — исторические брифы. Это provenance, а не автоматический контракт текущей реализации.
- [`apps/api/README.md`](../apps/api/README.md) — контракты и границы TypeScript API.

## Реализация и качество

- [`review-baseline.md`](review-baseline.md) — текущий обзор базового приложения, выполненные проверки и непроверенные runtime-сценарии.
- [`app-stability-analysis.md`](app-stability-analysis.md) — прежний анализ Canvas и доставки Telegram updates; для актуального статуса см. review.
- [`assets.md`](assets.md) и [`brand-spec.md`](../brand-spec.md) — каталог ресурсов и визуальная система. Brand spec не заменяет runtime-контракты из README/API.
- `docs/codex-desktop-audit.md` и `docs/codex-skills-audit.json` — локальные audit-артефакты со сведениями о среде и host-specific путями; не включать в перенос ветки без отдельной очистки.

## Будущее направление

- [`world-map-spec.md`](world-map-spec.md), [`world-map-architecture.md`](world-map-architecture.md), [`world-map-database.md`](world-map-database.md) и [`world-map-pki.md`](world-map-pki.md) — проекты будущего модуля «Мир». Они не реализованы текущими миграциями и не входят в активный baseline.

## Проектные skills

Портативные инструкции лежат в [`.agents/skills/`](../.agents/skills/). Они нужны вместе с `AGENTS.md`, поскольку там указаны маршруты по HTTP, PostgreSQL, Docker, security, архитектуре и диагностике.
