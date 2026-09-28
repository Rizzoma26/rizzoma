---
name: docker
description: "Изменение и диагностика Docker/Compose Rizzoma: service build, запуск, volumes, healthchecks и deployment. Использует локальный CLI, не Docker MCP."
---

# Docker Rizzoma

1. Определите среду и затронутый service (`web`, `api`, `bot`, `postgres`). Читайте только его секцию `docker-compose.yml`, нужный stage `Dockerfile` и связанные конфиги; для выпуска — `docs/environments.md`.
2. Используйте существующие `docker` / `docker compose`. С выбранным env-файлом сначала выполните `docker compose --env-file <path> config --quiet`: это проверяет конфигурацию без вывода подставленных секретов. Не печатайте полный `config`, `inspect` или environment.
3. Проверьте порты, volume/network scope, healthchecks, env validation и зависимости API/БД. В текущем Compose важны `APP_ENV`, `RELEASE_TAG` и уникальный `WEB_PORT`; не подставляйте реальные вымышленные домены или credentials.
4. Если задача требует проверки запуска, собирайте только изменённый service: `docker compose --env-file <path> build <service>`. Пересоздание через `up -d --no-deps <service>` допустимо, когда зависимости уже готовы; один `restart` не подхватит новый image/env. Не пересобирайте весь стек автоматически и не трогайте prod для QA.
5. Используйте `ps`, целевые поля health/status через `docker inspect --format` и ограниченные, отредактированные перед выводом логи нужного service. Логи могут содержать секреты; не отправляйте необработанный `docker logs` в контекст. Не удаляйте volumes для исправления запуска.
6. Отделите проверку синтаксиса, build, runtime health и реальный deployment в результате. Отсутствующий Docker daemon или env — ограничение проверки, не доказательство работоспособности. Порядок выпуска и backups берите из операционного документа, не дублируйте здесь.
