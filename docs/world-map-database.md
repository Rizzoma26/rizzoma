# Модель данных модуля «Мир»

Статус: проект схемы БД v0.1

Связанные документы:

- [Техническое задание](world-map-spec.md)
- [Архитектура по уровням сложности](world-map-architecture.md)
- [TLS, mTLS и сертификаты](world-map-pki.md)

## 1. Выбор хранилища

Основное хранилище — PostgreSQL с PostGIS. Одна БД обслуживает модульный монолит.

Причины выбора:

- транзакционный claim и уникальные ограничения;
- географические типы и расчёт расстояния в метрах;
- надёжные внешние ключи;
- достаточная производительность для 2 000 участников и 50 точек;
- возможность расширять модель без отдельной геобазы;
- резервное копирование и point-in-time recovery.

Redis не является источником истины и не нужен в MVP.

## 2. Главные инварианты

1. Telegram ID однозначно соответствует одному пользователю.
2. Пользователь взаимодействует с миром только при активном membership.
3. Неоткрытая точка не возвращается пользователю ни одним публичным API.
4. Открытая ячейка принадлежит конкретной паре `user + world`.
5. Один пользователь получает одну точку не более одного раза.
6. Повтор одного claim не создаёт повторных наград и ranking events.
7. QR не содержит `point_id`, награду или другой предсказуемый идентификатор.
8. В БД хранится хэш QR-токена, но не сам токен.
9. Набор наград после claim фиксируется снимком: последующее редактирование шаблона не
   меняет уже выданную награду.
10. Промокод не назначается двум пользователям.
11. Удаление точки, мира или участника не уничтожает историю claims.
12. Сырой Telegram `initData` не сохраняется.
13. Access token и административный client certificate идентифицируются по хэшу или
   fingerprint; секретный материал в БД не хранится.

## 3. Схема связей

```text
cities 1 ─── * worlds 1 ─── * points 1 ─── * point_qr_tokens
                  │              │
                  │              └──── * claims * ─── 1 users
                  │                         │
                  │                         └──── * user_rewards
                  │                                  │
                  │                                  * reward_components
                  │                                  │
                  │                                  1 reward_bundles
                  │
users 1 ─── * world_members * ─── 1 worlds
  │               │
  │               ├──── * discovered_cells
  │               └──── * tracking_sessions ─── * location_samples
  │
  ├──── * api_sessions
  ├──── * ranking_events
  └──── * audit_events

service_principals 1 ─── * service_certificates
```

## 4. Общие соглашения

- Внутренние идентификаторы — UUID.
- Время — `timestamptz` в UTC.
- Географические координаты — `geography(Point, 4326)`.
- Бизнес-статусы — `text` с `CHECK`, а не неуправляемые строки.
- Все изменяемые сущности имеют `created_at` и `updated_at`.
- Production-сущности не удаляются физически, если на них ссылается история.
- JSONB допускается только для ограниченных типозависимых настроек, которые проходят
  runtime-валидацию. Основные связи и ограничения остаются реляционными.
- Денежные значения, если появятся, хранятся целым числом минимальных единиц и валютой.

## 5. Пользователи и сессии

### 5.1. `users`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `telegram_user_id` | bigint | NOT NULL, UNIQUE, `> 0` |
| `username` | text | NULL, максимум 64 |
| `first_name` | text | NULL, максимум 128 |
| `last_name` | text | NULL, максимум 128 |
| `status` | text | `active`, `blocked`, `deleted` |
| `created_at` | timestamptz | NOT NULL |
| `last_seen_at` | timestamptz | NOT NULL |

Telegram-профиль является отображаемыми метаданными, а не доказательством прав. Все
права берутся из `world_members` и ролей сервиса.

### 5.2. `api_sessions`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `users`, NOT NULL |
| `token_hash` | bytea | UNIQUE, NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `expires_at` | timestamptz | NOT NULL |
| `revoked_at` | timestamptz | NULL |
| `last_used_at` | timestamptz | NULL |

Сервер выдаёт случайный opaque access token. В БД сохраняется SHA-256 хэш. Токен живёт
в памяти Mini App; после перезагрузки выполняется новый обмен Telegram `initData`.

Индексы:

- UNIQUE по `token_hash`;
- индекс по `(user_id, expires_at)`;
- частичный индекс активных сессий `WHERE revoked_at IS NULL`.

## 6. Города, миры и участие

### 6.1. `cities`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `slug` | text | UNIQUE, NOT NULL |
| `name` | text | NOT NULL |
| `timezone` | text | NOT NULL, для MVP `Europe/Moscow` |
| `boundary` | geography(MultiPolygon, 4326) | NOT NULL |
| `default_center` | geography(Point, 4326) | NOT NULL |
| `default_zoom` | real | NOT NULL |
| `status` | text | `active`, `disabled` |

`boundary` задаёт допустимую игровую область, а не административную границу города.

### 6.2. `worlds`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `city_id` | uuid | FK → `cities`, NOT NULL |
| `slug` | text | NOT NULL |
| `name` | text | NOT NULL |
| `status` | text | `draft`, `active`, `paused`, `archived` |
| `h3_resolution` | smallint | NOT NULL, `0..15` |
| `reveal_radius_m` | integer | NOT NULL, `> 0` |
| `claim_radius_m` | integer | NOT NULL, по умолчанию 100 |
| `max_location_accuracy_m` | integer | NOT NULL, по умолчанию 100 |
| `max_location_age_seconds` | integer | NOT NULL, по умолчанию 30 |
| `starts_at` | timestamptz | NULL |
| `ends_at` | timestamptz | NULL |
| `display_config` | jsonb | только валидируемые UI-настройки |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

Ограничения:

- UNIQUE `(city_id, slug)`;
- `ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at`;
- геопроверка и членство никогда не выключаются полем `display_config`.

### 6.3. `world_members`

| Поле | Тип | Ограничения |
|---|---|---|
| `world_id` | uuid | FK → `worlds` |
| `user_id` | uuid | FK → `users` |
| `status` | text | `invited`, `active`, `suspended`, `revoked` |
| `source_type` | text | `purchase`, `invite`, `manual`, `node`, `system` |
| `source_ref` | text | NULL, внешний безопасный идентификатор |
| `joined_at` | timestamptz | NULL |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

PK: `(world_id, user_id)`.

Запись не удаляется при отзыве доступа: меняется `status`, чтобы claims и аудит оставались
связанными с исходным membership.

## 7. Медиа и точки

### 7.1. `media_assets`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `storage_key` | text | UNIQUE, NOT NULL |
| `mime_type` | text | allowlist: JPEG, PNG, WebP, AVIF |
| `size_bytes` | bigint | NOT NULL, ограничение размера |
| `sha256` | bytea | UNIQUE, NOT NULL |
| `width` | integer | NOT NULL |
| `height` | integer | NOT NULL |
| `status` | text | `pending`, `ready`, `blocked` |
| `created_at` | timestamptz | NOT NULL |

Клиент не получает произвольный storage URL из импорта. API строит URL только для
объектов со статусом `ready` в разрешённом bucket/CDN.

### 7.2. `points`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `world_id` | uuid | FK → `worlds`, NOT NULL |
| `external_id` | text | NOT NULL, стабильный ключ импорта |
| `name` | text | NOT NULL, максимум 160 |
| `address` | text | NOT NULL, максимум 300 |
| `description` | text | NOT NULL, максимум 4 000 |
| `image_asset_id` | uuid | FK → `media_assets`, NULL |
| `location` | geography(Point, 4326) | NOT NULL |
| `reveal_cell` | text | NOT NULL, H3-ячейка точки |
| `reward_bundle_id` | uuid | FK → `reward_bundles`, NOT NULL |
| `status` | text | `draft`, `active`, `disabled`, `archived` |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

Ограничения и индексы:

- UNIQUE `(world_id, external_id)`;
- UNIQUE `(id, world_id)` для составных внешних ключей;
- GiST по `location`;
- B-tree по `(world_id, status)`;
- B-tree по `(world_id, reveal_cell)`;
- импорт проверяет, что `location` находится внутри `cities.boundary`;
- `reveal_cell` вычисляется сервером из координат и `worlds.h3_resolution`, а не
  принимается на доверии из CSV.

Точка с claims не удаляется. Для прекращения выдачи используется `disabled` или
`archived`.

## 8. QR-токены

### 8.1. `point_qr_tokens`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `point_id` | uuid | FK → `points`, NOT NULL |
| `token_hash` | bytea | UNIQUE, NOT NULL |
| `token_hint` | text | последние 6 безопасных символов для оператора |
| `status` | text | `active`, `revoked`, `expired` |
| `issued_at` | timestamptz | NOT NULL |
| `expires_at` | timestamptz | NULL |
| `revoked_at` | timestamptz | NULL |
| `revoke_reason` | text | NULL |

Токен генерируется CSPRNG как минимум из 32 случайных байт и кодируется base64url. Для
поиска используется SHA-256 хэш. Медленный password hash не нужен, потому что токен имеет
высокую энтропию и не подбирается по словарю.

Частичный уникальный индекс допускает один активный QR на точку:

```sql
CREATE UNIQUE INDEX uq_point_one_active_qr
ON point_qr_tokens(point_id)
WHERE status = 'active';
```

Перевыпуск выполняется транзакцией: старый токен отзывается, новый создаётся, операция
пишется в аудит.

## 9. Tracking и туман

### 9.1. `tracking_sessions`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `world_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `status` | text | `active`, `paused`, `closed` |
| `started_at` | timestamptz | NOT NULL |
| `last_sample_at` | timestamptz | NULL |
| `last_location` | geography(Point, 4326) | NULL |
| `last_accuracy_m` | real | NULL |
| `ended_at` | timestamptz | NULL |

Составной FK `(world_id, user_id)` → `world_members` не позволяет создать tracking для
несуществующего membership. Статус membership дополнительно проверяется приложением.

### 9.2. `location_samples`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | bigint identity | PK |
| `tracking_session_id` | uuid | FK → `tracking_sessions` |
| `captured_at` | timestamptz | NOT NULL |
| `received_at` | timestamptz | NOT NULL |
| `location` | geography(Point, 4326) | NOT NULL |
| `accuracy_m` | real | NOT NULL, `> 0` |
| `speed_mps` | real | NULL, `>= 0` |
| `verdict` | text | `accepted`, `rejected` |
| `reject_reason` | text | NULL |

Индексы:

- `(tracking_session_id, captured_at)`;
- BRIN по `received_at`, если объём станет значительным.

Сырые образцы имеют короткий TTL, предлагаемый для MVP — 24 часа. После очистки остаются
только `discovered_cells` и агрегированная security-телеметрия.

### 9.3. `discovered_cells`

| Поле | Тип | Ограничения |
|---|---|---|
| `world_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `h3_index` | text | NOT NULL, валидный индекс выбранного resolution |
| `first_discovered_at` | timestamptz | NOT NULL |
| `source` | text | `online`, `offline_sync`, `admin` |
| `tracking_session_id` | uuid | NULL |

PK: `(world_id, user_id, h3_index)`.

Составной FK `(world_id, user_id)` → `world_members`. Повторное открытие ячейки не создаёт
новую запись:

```sql
INSERT INTO discovered_cells (...)
VALUES (...)
ON CONFLICT (world_id, user_id, h3_index) DO NOTHING;
```

Точки пользователя выбираются только через пересечение `points.reveal_cell` с его
`discovered_cells`.

## 10. Награды

### 10.1. `reward_bundles`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `world_id` | uuid | FK → `worlds` |
| `internal_name` | text | NOT NULL, не выдаётся до claim |
| `status` | text | `draft`, `active`, `retired` |
| `version` | integer | NOT NULL, `> 0` |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

### 10.2. `reward_components`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `bundle_id` | uuid | FK → `reward_bundles` |
| `kind` | text | `digital`, `promo`, `physical`, `tree_progress` |
| `position` | smallint | NOT NULL |
| `config` | jsonb | схема зависит от `kind`, без одноразовых секретов |
| `status` | text | `active`, `disabled` |

UNIQUE `(bundle_id, position)`.

Примеры `config`:

- `digital`: идентификатор предмета и отображаемые метаданные;
- `physical`: способ выдачи `onsite/staff/instruction`;
- `tree_progress`: тип и величина серверного прогресса;
- `promo`: ссылка на пул промокодов, но не сам код.

### 10.3. `promo_codes`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `reward_component_id` | uuid | FK → `reward_components` |
| `code_hash` | bytea | UNIQUE, NOT NULL |
| `code_ciphertext` | bytea | NOT NULL, шифрование на уровне приложения/KMS |
| `key_version` | text | NOT NULL |
| `status` | text | `available`, `assigned`, `redeemed`, `revoked` |
| `assigned_user_reward_id` | uuid | UNIQUE, NULL |
| `created_at` | timestamptz | NOT NULL |

Назначение кода выполняется внутри claim через `FOR UPDATE SKIP LOCKED`, чтобы один код
не был выдан двум пользователям.

### 10.4. `user_rewards`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `claim_id` | uuid | FK → `claims` |
| `reward_component_id` | uuid | FK → `reward_components` |
| `user_id` | uuid | FK → `users` |
| `kind` | text | снимок типа награды |
| `payload_ciphertext` | bytea | зашифрованный снимок выданного результата |
| `key_version` | text | версия ключа шифрования |
| `status` | text | `assigned`, `revealed`, `fulfilled`, `redeemed`, `revoked` |
| `created_at` | timestamptz | NOT NULL |
| `revealed_at` | timestamptz | NULL |
| `fulfilled_at` | timestamptz | NULL |

UNIQUE `(claim_id, reward_component_id)`.

Снимок делает выданную награду независимой от дальнейшего редактирования bundle.
Доступ к расшифровке имеет только сервер; API возвращает награду только её владельцу.

Для `tree_progress` серверный `user_reward` является источником события. Пока текущее
дерево RIZZOMA хранит прогресс только на клиенте, безопасно начислять такой компонент
нельзя: соответствующее состояние дерева должно быть перенесено на сервер либо награда
остаётся в статусе `assigned` до интеграции.

## 11. Claims

### 11.1. `claims`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `world_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `point_id` | uuid | NOT NULL |
| `qr_token_id` | uuid | FK → `point_qr_tokens` |
| `tracking_session_id` | uuid | NULL |
| `idempotency_key` | uuid | NOT NULL |
| `claimed_at` | timestamptz | NOT NULL |
| `claim_location` | geography(Point, 4326) | NOT NULL |
| `accuracy_m` | real | NOT NULL |
| `distance_m` | real | NOT NULL |
| `location_captured_at` | timestamptz | NOT NULL |

Ограничения:

- FK `(world_id, user_id)` → `world_members`;
- FK `(point_id, world_id)` → `points(id, world_id)`;
- UNIQUE `(user_id, point_id)`;
- UNIQUE `(user_id, idempotency_key)`;
- `accuracy_m > 0`;
- `distance_m >= 0`.

В таблицу попадают только успешные claims. Отклонённые попытки находятся в
`claim_attempts` с ограниченным сроком хранения.

### 11.2. `claim_attempts`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | bigint identity | PK |
| `user_id` | uuid | NULL для неавторизованного запроса |
| `point_id` | uuid | NULL, если QR не распознан |
| `token_fingerprint` | bytea | ограниченный fingerprint, не сырой токен |
| `result_code` | text | стабильный код причины |
| `distance_m` | real | NULL |
| `accuracy_m` | real | NULL |
| `ip_daily_hash` | bytea | NULL, меняемая соль |
| `created_at` | timestamptz | NOT NULL |

TTL для MVP — 30 дней, после чего остаются только агрегаты.

### 11.3. Транзакция claim

```text
BEGIN
  1. Найти активную api_session и user.
  2. Заблокировать active world_member.
  3. Хэшировать QR и найти active point_qr_token.
  4. Заблокировать point и проверить status/world.
  5. Проверить, что reveal_cell открыт пользователем.
  6. Рассчитать ST_Distance и проверить radius/accuracy/freshness.
  7. INSERT claim.
     При конфликте (user_id, point_id) вернуть существующий claim.
  8. Зафиксировать snapshot каждого reward_component в user_rewards.
  9. Для promo атомарно зарезервировать один available code.
 10. INSERT ranking_event с уникальным source claim.
 11. INSERT audit/security event без секретных payload.
COMMIT
```

Никакой внешний HTTP-вызов не выполняется внутри транзакции. Если позже понадобится
уведомление или интеграция, после коммита используется outbox.

## 12. Ranking и аудит

### 12.1. `ranking_events`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | bigint identity | PK |
| `world_id` | uuid | FK → `worlds` |
| `user_id` | uuid | FK → `users` |
| `event_type` | text | `cell_discovered`, `point_claimed` |
| `source_type` | text | `cell`, `claim` |
| `source_id` | text | стабильный идентификатор источника |
| `occurred_at` | timestamptz | NOT NULL |
| `metadata` | jsonb | безопасные несекретные данные |

UNIQUE `(event_type, source_type, source_id)` предотвращает двойной учёт. Формула очков
не хранится в событии и может быть добавлена позже.

### 12.2. `audit_events`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | bigint identity | PK |
| `actor_type` | text | `user`, `service`, `system` |
| `actor_id` | text | NOT NULL |
| `action` | text | NOT NULL |
| `entity_type` | text | NOT NULL |
| `entity_id` | text | NOT NULL |
| `request_id` | uuid | NULL |
| `before_data` | jsonb | отредактированный снимок без секретов |
| `after_data` | jsonb | отредактированный снимок без секретов |
| `created_at` | timestamptz | NOT NULL |

Аудит append-only для runtime-роли БД.

## 13. Сервисные субъекты и сертификаты

### 13.1. `service_principals`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | UNIQUE, NOT NULL |
| `role` | text | `content_operator`, `deployer`, `readonly`, `service` |
| `status` | text | `active`, `suspended`, `revoked` |
| `created_at` | timestamptz | NOT NULL |

### 13.2. `service_certificates`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK |
| `principal_id` | uuid | FK → `service_principals` |
| `fingerprint_sha256` | bytea | UNIQUE, NOT NULL |
| `issuer_dn` | text | NOT NULL |
| `subject_dn` | text | NOT NULL |
| `serial_number` | text | NOT NULL |
| `not_before` | timestamptz | NOT NULL |
| `not_after` | timestamptz | NOT NULL |
| `revoked_at` | timestamptz | NULL |
| `revoke_reason` | text | NULL |
| `created_at` | timestamptz | NOT NULL |

UNIQUE `(issuer_dn, serial_number)`.

Private key и сам клиентский сертификат в БД не хранятся. TLS gateway проверяет цепочку
доверия, а API сопоставляет проверенный fingerprint с активным principal и ролью.

## 14. Роли PostgreSQL

Минимум три роли:

- `rizzoma_runtime`: SELECT/INSERT/UPDATE только необходимых таблиц, без DDL и выдачи
  прав;
- `rizzoma_migrator`: создание и изменение схемы, используется только deployment job;
- `rizzoma_readonly`: ограниченная диагностика без расшифровки наград и секретных полей.

Runtime не должен иметь права:

- `DROP/ALTER`;
- создавать расширения;
- изменять миграции;
- читать секреты инфраструктуры;
- выполнять неограниченные административные функции.

Подключение к PostgreSQL использует TLS с полной проверкой сертификата и hostname.
Детали описаны в [world-map-pki.md](world-map-pki.md).

## 15. Политика удаления и хранения

Предлагаемые значения для MVP:

| Данные | Срок |
|---|---|
| Telegram `initData` | не хранить |
| API session | до истечения + 7 дней для очистки |
| Сырые exploration location samples | 24 часа |
| Claim location | 30 дней, затем удалить или огрубить после решения продукта |
| Claim и user reward | долговременно |
| Отклонённые claim attempts | 30 дней |
| Ranking events | долговременно |
| Audit events | минимум 1 год |
| Отозванные сертификаты и QR | минимум срок аудита |

Точные сроки утверждаются отдельно до production. Очистка выполняется серверной задачей
по явным правилам, а не каскадным удалением пользователя.

## 16. Миграции и резервное копирование

- Каждое изменение схемы — отдельная версионированная миграция.
- Миграции проверяются на пустой БД и на копии схемы предыдущей версии.
- Разрушительные миграции выполняются по expand/migrate/contract, а не одним шагом.
- Перед production-миграцией создаётся проверяемая точка восстановления.
- Резервная копия выполняется ежедневно.
- Восстановление проверяется регулярно на отдельной БД.
- Backup шифруется и доступен отдельной инфраструктурной роли.
- Seed-данные разработки не выполняются в production.

## 17. Минимальные проверки схемы

Автотесты БД должны доказывать:

- невозможно создать два claims для одной пары user/point;
- невозможно выдать один promo code двум user rewards;
- невозможно создать point для несуществующего world;
- невозможно создать tracking session без membership;
- отозванный QR не выбирается claim-запросом;
- скрытая point не попадает в map-state без discovered cell;
- редактирование reward bundle не меняет snapshot старого user reward;
- runtime-роль не может выполнить DDL;
- migrator и runtime используют разные учётные данные;
- revoked service certificate не даёт административного доступа.
