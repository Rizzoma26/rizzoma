# TLS, mTLS и сертификаты модуля «Мир»

Статус: проект защитного контура v0.1

Связанные документы:

- [Техническое задание](world-map-spec.md)
- [Архитектура](world-map-architecture.md)
- [Модель данных](world-map-database.md)

## 1. Что означает «защита по сертификату»

Для проекта нужны четыре разных сертификатных контура:

1. **Публичный HTTPS:** Telegram Mini App проверяет TLS-сертификат домена клиента и API
   через системное хранилище доверия Telegram/WebView.
2. **API → PostgreSQL:** API проверяет сертификат сервера БД и hostname; при возможности
   PostgreSQL дополнительно проверяет клиентский сертификат API.
3. **Admin CLI → внутренний API:** взаимная TLS-аутентификация (mTLS) с отдельным
   сертификатом для каждого оператора или deployment job.
4. **Service-to-service:** mTLS появляется только при нескольких сервисах/worker на
   уровне архитектуры 2 и выше.

Пользовательский Telegram Mini App не получает клиентский сертификат. Идентификация
пользователя выполняется через проверенный Telegram `initData` и короткую API-сессию.

## 2. Что сертификаты защищают и не защищают

Сертификаты защищают:

- трафик от чтения и изменения по пути;
- клиента от подключения к поддельному серверу;
- внутренний endpoint от клиента без доверенного mTLS-сертификата;
- БД от подключения приложения с неподтверждённой машинной идентичностью.

Сертификаты не защищают:

- от XSS в уже загруженном клиенте;
- от украденного Telegram-сеанса;
- от подмены GPS;
- от пересланной фотографии QR;
- от оператора с действующим сертификатом и избыточной ролью;
- от утечки private key на скомпрометированном устройстве.

Поэтому TLS/mTLS дополняет, но не заменяет HMAC Telegram, membership, RBAC, CSP,
транзакционные ограничения и аудит.

## 3. Публичный контур: Telegram Mini App → Web/API

```text
Telegram WebView
    ├── HTTPS ──► app.example.ru
    └── HTTPS ──► api.example.ru
                     │
                     ▼
              TLS gateway/load balancer
                     │ private network/loopback
                     ▼
                   API
```

Требования:

- только HTTPS;
- сертификат публично доверенного CA;
- SAN содержит точное имя домена;
- TLS 1.2 и TLS 1.3;
- HTTP перенаправляется на HTTPS без передачи чувствительных данных;
- HSTS включается после проверки HTTPS на всех нужных поддоменах;
- mixed content запрещён;
- private key хранится у managed load balancer или в secret storage, не в Git и не в
  образе приложения;
- сертификат обновляется автоматически;
- выпуск и обновление логируются;
- срок действия и ошибки renewal мониторятся.

Предлагаемый rollout HSTS:

1. `max-age=86400` без `includeSubDomains` на пилоте.
2. После проверки всех поддоменов — увеличение до 6–12 месяцев.
3. `includeSubDomains` и preload используются только после отдельной проверки, потому что
   ошибка может заблокировать рабочие поддомены.

## 4. Certificate pinning в Mini App

Собственный certificate pinning в Telegram Mini App не закладывается.

Причины:

- TLS-соединением управляет Telegram WebView/браузер, а не JavaScript приложения;
- клиентский код не получает сертификат сервера для собственной проверки;
- HTTP Public Key Pinning является устаревшим браузерным механизмом;
- жёсткий pin осложняет безопасную ротацию сертификатов и может полностью заблокировать
  пользователей при ошибке.

Вместо pinning используются публичный CA, системное хранилище доверия, HSTS, Certificate
Transparency провайдера и автоматическое обновление. HPKP помечен как устаревший механизм
в [MDN](https://developer.mozilla.org/en-US/docs/Glossary/HPKP).

Если certificate pinning станет обязательным требованием, потребуется нативный клиент,
а не только Telegram Mini App.

## 5. API → PostgreSQL

Минимальное обязательное требование — TLS с полной проверкой сервера:

```text
sslmode=verify-full
CA bundle = доверенный CA PostgreSQL
hostname = имя из SAN сертификата
```

`sslmode=require` недостаточен: он шифрует соединение, но сам по себе не гарантирует
проверку личности сервера. PostgreSQL рекомендует `verify-full` для чувствительных
окружений: [официальная документация PostgreSQL](https://www.postgresql.org/docs/current/libpq-ssl.html).

### Рекомендуемый MVP

- API проверяет server certificate БД и hostname (`verify-full`).
- PostgreSQL принимает только TLS-подключения.
- API использует отдельную runtime-роль и пароль SCRAM либо client certificate, если это
  поддерживается выбранным managed PostgreSQL.
- Deployment job использует отдельную migrator-роль и отдельный сертификат/секрет.
- CA bundle поставляется через secret storage и ротируется контролируемо.

### Усиленный вариант

Включить обязательный клиентский сертификат:

```text
hostssl ... rizzoma_runtime ... cert clientcert=verify-full
```

PostgreSQL умеет проверять client certificate и сопоставлять CN/DN с ролью. Это описано в
[Certificate Authentication](https://www.postgresql.org/docs/current/auth-cert.html).

У runtime API, migrator и readonly-инструмента должны быть разные сертификаты и разные
роли. Один общий сертификат запрещён.

## 6. Admin CLI → внутренний API

Административный импорт точек и выпуск QR не должны использовать публичный скрытый
endpoint, защищённый только строковым токеном.

Рекомендуемый контур MVP:

```text
Operator/deployment job
  ├─ individual client certificate
  └─ mTLS
        ▼
admin-api.internal.example.ru
        ▼
TLS gateway validates private CA, expiry and revocation
        ▼ verified certificate fingerprint
Node API maps fingerprint → service_principal → role
        ▼
authorized command + audit event
```

Требования:

- отдельный внутренний hostname;
- доступ через private network/VPN или строгий network allowlist;
- private CA отделён от публичного CA;
- отдельный client certificate для каждого оператора и deployment job;
- срок client certificate 30–90 дней;
- TLS gateway проверяет цепочку, срок и revocation;
- API повторно проверяет fingerprint по `service_certificates`;
- роль проверяется для каждой команды;
- сертификат не заменяет application-level authorization;
- все команды имеют `request_id`, dry-run и audit event;
- внешний запрос не может передать поддельный заголовок fingerprint.

Если gateway передаёт идентичность сертификата заголовком:

- gateway удаляет одноимённый входящий заголовок;
- API принимает соединения только от gateway;
- между gateway и API используется loopback/private network либо второй mTLS-канал;
- формат и подпись заголовка фиксируются инфраструктурой.

## 7. Service-to-service mTLS

На уровне 1 отдельного service-to-service контура нет: API является одним процессом.

Когда появляются worker или отдельный сервис:

- каждый workload получает отдельный certificate identity;
- сертификат ограничен конкретным environment и service name;
- доступ строится по allowlist service-to-service;
- сертификаты короткоживущие и автоматически обновляются;
- отказ renewal переводит сервис в недоступное состояние, а не в insecure fallback;
- plaintext fallback запрещён.

Не нужно внедрять service mesh только ради двух процессов. Достаточно TLS gateway или
прямого mTLS с автоматической выдачей сертификатов.

## 8. Хранение ключей

Запрещено хранить private keys:

- в Git;
- в `config.js`;
- в `.env.example`;
- внутри Docker image;
- в БД приложения;
- в логах CI;
- в общем файле для нескольких операторов.

Разрешённые варианты:

- managed certificate на load balancer;
- secret manager с ограниченной IAM-ролью;
- защищённое хранилище deployment runner;
- системный Keychain/Keystore для индивидуального admin CLI;
- автоматическая workload identity для сервисов.

Файловый private key, если без него нельзя обойтись, имеет права только на чтение
владельцем процесса и не копируется между окружениями.

## 9. Жизненный цикл сертификата

Для каждого сертификата определены:

- владелец;
- назначение;
- разрешённые DNS names или service identity;
- issuer/CA;
- срок действия;
- место хранения private key;
- механизм renewal;
- механизм отзыва;
- мониторинг;
- процедура аварийной ротации.

Предлагаемые сроки:

| Сертификат | Срок | Обновление |
|---|---:|---|
| Публичный HTTPS | срок CA, обычно короткий | автоматическое |
| Admin client certificate | 30–90 дней | управляемое/автоматическое |
| Workload certificate | часы или дни | автоматическое |
| Private intermediate CA | 1–3 года | контролируемая ротация |
| Root CA | дольше intermediate | офлайн, отдельная процедура |

Оповещения настраиваются минимум за 30, 14 и 7 дней до истечения. Renewal проверяется
отдельной synthetic-проверкой TLS, а не только фактом наличия нового файла.

## 10. Отзыв и компрометация

При утечке client private key:

1. сертификат немедленно помечается revoked у CA;
2. fingerprint помечается revoked в `service_certificates`;
3. gateway обновляет CRL/denylist;
4. связанные API-сессии и административные токены отзываются;
5. выпускается новый ключ и сертификат;
6. проверяются audit events с момента возможной компрометации;
7. инцидент фиксируется без публикации private key в тикете или логах.

При компрометации публичного TLS private key сертификат перевыпускается, старый
отзывается, ключи gateway ротируются, а журналы Certificate Transparency и доступа
проверяются.

## 11. Разделение окружений

Dev, staging и production используют:

- разные домены;
- разные CA или intermediate CA;
- разные PostgreSQL-сертификаты и роли;
- разные client certificates;
- разные object-storage credentials;
- разные Telegram bots или как минимум разные настройки приложения;
- отсутствие доверия сертификатам dev в production.

Production certificate никогда не копируется разработчику для локального запуска.

## 12. Проверки сертификатного контура

Автоматически или регулярно проверяется:

- HTTP не обслуживает приложение без redirect на HTTPS;
- сертификат домена доверен и hostname совпадает;
- TLS-соединение с БД падает при неверном CA или hostname;
- API не стартует с `sslmode=disable/prefer/allow` в production;
- admin endpoint отвергает запрос без client certificate;
- неизвестный, просроченный и отозванный client certificate отвергается;
- certificate fingerprint без активного principal не получает роль;
- поддельный forwarded certificate header снаружи удаляется gateway;
- runtime certificate не имеет прав migrator;
- dev certificate не принимается production;
- renewal и аварийная ротация проверены до запуска.

## 13. Минимум для запуска

До пилота обязательно:

1. Публичный HTTPS для клиента и API с автоматическим renewal.
2. HSTS после короткого безопасного rollout.
3. PostgreSQL TLS `verify-full`.
4. Раздельные runtime/migrator credentials.
5. mTLS для внутреннего admin CLI endpoint.
6. Отдельный client certificate на оператора/job.
7. Таблицы `service_principals` и `service_certificates`.
8. Audit log административных операций.
9. Мониторинг срока сертификатов.
10. Документированная процедура отзыва.

Client-certificate authentication пользователей Telegram, HPKP и service mesh в MVP не
нужны.
