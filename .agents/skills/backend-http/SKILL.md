---
name: backend-http
description: "Изменение HTTP/API Rizzoma: Express endpoints, services, fetch, request/response и внешние интеграции. Для SQL-реализации выбирайте postgres отдельно."
---

# HTTP Rizzoma

- Проследите только затронутый запрос: caller → маршрут → service. API собирается в `apps/api/src/app.ts`; перед добавлением маршрута проверьте порядок middleware и границу session protection.
- Переиспользуйте `http/request.ts` (`parseBody`), `http/app-error.ts` (`AppError`), `observability/error-handler.ts` и схемы `@rizzoma/contracts` из `packages`. Сервис содержит сценарий, repository — работу с БД; не переносите SQL в handler.
- Для исходящего запроса сначала найдите существующий caller/helper в затронутой части web/bot/API. Не предполагайте наличие общего HTTP client и не создавайте параллельный helper, если подходящий уже есть.
- Для изменяемого сетевого пути обеспечьте ограниченный timeout, отмену через подходящий AbortSignal, обработку HTTP status, не-JSON/невалидного ответа и transport error. Проверяйте данные на границе; retry записи допустим лишь с понятной идемпотентностью.
- Сохраняйте структурированный error contract; не отдавайте внутренние ошибки клиенту. Логируйте безопасные code/status/request ID, без payload авторизации и credentials.
- Проверьте изменённый happy path и релевантный отказ существующим targeted тестом. При изменении контрактов проверьте callers и выполните typecheck/build затронутых workspace с учётом зависимости от contracts.

При изменении доступа используйте security-review; не запускайте полный security checklist для каждой HTTP-правки.
