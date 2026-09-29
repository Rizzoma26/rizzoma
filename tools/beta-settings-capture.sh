#!/bin/sh
# Снимок настройки беты одного контура ДО переноса в BETA_OPEN
# (скилл .agents/skills/beta-config-02-capture-values).
#
# Только чтение: SQL идёт в read-only транзакции, env-файл не меняется.
# Печатает публичные индексы узлов (они и так уходят клиентам в /api/state)
# и статусы переменных. Секреты, DATABASE_URL и id администратора — нет.
#
#   tools/beta-settings-capture.sh /etc/rizzoma/dev.env
#   tools/beta-settings-capture.sh /etc/rizzoma/prod.env   # только с согласия владельца
#
# Запускать до выкладки кода без beta_settings и до миграции 003:
# после 003 таблицы нет и снимать уже нечего.
set -eu

ENVFILE=${1:-}
if [ -z "$ENVFILE" ] || [ ! -r "$ENVFILE" ]; then
  echo "использование: $0 /etc/rizzoma/<dev|prod>.env (файл должен быть доступен на чтение)" >&2
  exit 2
fi
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)

value_of() { sed -n "s/^$1=//p" "$ENVFILE" | tail -n 1; }

APP_ENV=$(value_of APP_ENV)
case "$APP_ENV" in
  dev|prod) ;;
  *) echo "APP_ENV в $ENVFILE должен быть dev или prod" >&2; exit 1 ;;
esac
# Имя проекта задаёт docker-compose.yml: rizzoma-${APP_ENV}. Переопределение
# увело бы запрос в чужой контур.
if [ -n "${COMPOSE_PROJECT_NAME:-}" ] || grep -q '^COMPOSE_PROJECT_NAME=' "$ENVFILE"; then
  echo "COMPOSE_PROJECT_NAME задан: контур нельзя определить надёжно, остановка" >&2
  exit 1
fi

# docker-compose.yml требует BETA_OPEN, а до снимка его в env может не быть.
# Заглушка нужна только для подстановки в файл: ps и exec контейнеры не
# пересоздают и значение никуда не передают.
compose() {
  BETA_OPEN=${BETA_OPEN:-0} docker compose --project-directory "$ROOT" \
    -f "$ROOT/docker-compose.yml" --env-file "$ENVFILE" "$@"
}
if ! compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "контур rizzoma-$APP_ENV: postgres не запущен — эффективное значение не измерено" >&2
  exit 1
fi

SNAPSHOT=$(compose exec -T postgres \
  sh -c 'psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$ROOT/tools/beta-settings-capture.sql")
field() { printf '%s\n' "$SNAPSHOT" | sed -n "s/^$1=//p" | tail -n 1; }

normalize() { printf '%s' "$1" | tr ',' '\n' | tr -d ' ' | sed '/^$/d' | sort -n -u | paste -sd, -; }

DEFAULT=$(sed -n 's/^const BETA_OPEN = \[\(.*\)\];.*/\1/p' "$ROOT/economy.js" | tr -d ' ')
ENV_RAW=$(value_of BETA_OPEN)
if [ -z "$ENV_RAW" ]; then
  ENV_SHOWN='<unset>'; ENV_NORM=''
elif printf '%s' "$ENV_RAW" | grep -Eq '^ *[0-9]+ *(, *[0-9]+ *)*$'; then
  ENV_NORM=$(normalize "$ENV_RAW"); ENV_SHOWN=$ENV_NORM
else
  ENV_SHOWN='<invalid>'; ENV_NORM=''
fi
status() { [ -n "$(value_of "$1")" ] && echo '<set>' || echo '<unset>'; }

echo "contour=$APP_ENV (compose project rizzoma-$APP_ENV)"
echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "migrations=$(field migrations)"
echo "QA_ENABLED=$(value_of QA_ENABLED) ADMIN_TG_IDS=$(status ADMIN_TG_IDS)"
echo "env BETA_OPEN=$ENV_SHOWN"
echo "economy.js default=$DEFAULT"

if [ "$(field table)" = present ] && [ -n "$(printf '%s\n' "$SNAPSHOT" | grep '^db_beta_open=')" ]; then
  RAW=$(field db_beta_open); NORM=$(field db_beta_open_normalized)
  echo "db beta_open=$RAW changed_by_admin=$(field changed_by_admin) updated_at=$(field updated_at)"
  if [ -z "$NORM" ]; then
    echo "WARNING: в БД пустой список — клиенты его игнорировали и держали свой кэш." >&2
    echo "         Значение BETA_OPEN для этого контура выбирает владелец." >&2
    exit 3
  fi
  [ "$RAW" = "$NORM" ] || echo "CONTRADICTION: /api/state отдавал $RAW, модуль отдаёт по возрастанию без повторов: $NORM"
  [ -z "$ENV_NORM" ] || [ "$ENV_NORM" = "$NORM" ] || \
    echo "CONTRADICTION: env BETA_OPEN=$ENV_NORM, а действует значение из БД $NORM — сохранить значение БД"
  echo "effective=$NORM (измерено: строка beta_settings)"
  EFFECTIVE=$NORM
else
  EFFECTIVE=${ENV_NORM:-$DEFAULT}
  echo "effective=$EFFECTIVE (выведено, не измерено: строки beta_settings нет, бот создал бы её из env или значения по умолчанию)"
fi

echo
echo "записать в $ENVFILE после подтверждения владельца (сначала cp -p на резервную копию):"
echo "BETA_OPEN=$EFFECTIVE"
