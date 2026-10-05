#!/usr/bin/env bash
# Выкатка окружений: main → prod, qa → qa, dev → dev. Образы собирает GitHub Actions
# (только после зелёных тестов), этот скрипт их забирает и поднимает.
#
#   rizzoma-deploy.sh <env> <sha>   одно окружение на конкретный коммит — так зовёт
#                                   GitHub Actions (job deploy в deploy.yml), лог виден там
#   rizzoma-deploy.sh               все окружения по головам веток — ручной запуск
#   rizzoma-deploy.sh --ssh         вход для ключа CI: команда берётся из SSH_ORIGINAL_COMMAND
#                                   (ключ в authorized_keys ограничен этим режимом)
set -euo pipefail

ROOT=/opt/rizzoma
SRC=$ROOT/src
REPO=https://github.com/Rizzoma26/rizzoma.git
REGISTRY=ghcr.io/rizzoma26

if [ "${1:-}" = --ssh ]; then
  # Ключ CI умеет ровно одно: «<env> <sha>». Всё остальное — отказ.
  read -r a b extra <<< "${SSH_ORIGINAL_COMMAND:-}"
  if [[ ! "$a" =~ ^(prod|qa|dev)$ || ! "$b" =~ ^[0-9a-f]{40}$ || -n "${extra:-}" ]]; then
    echo "ожидается: <prod|qa|dev> <sha коммита>" >&2; exit 2
  fi
  set -- "$a" "$b"
fi

TARGET=${1:-} WANT_SHA=${2:-}

exec 9>"$ROOT/.deploy.lock"
if [ -n "$TARGET" ]; then
  flock -w 900 9 || { echo "другая выкатка не закончилась за 15 минут" >&2; exit 1; }
else
  flock -n 9 || { echo "уже идёт другая выкатка"; exit 0; }
fi

log(){ echo "$*"; }

[ -d "$SRC/.git" ] || git clone -q "$REPO" "$SRC"
git -C "$SRC" fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*'
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null

has_images(){   # sha image…
  local sha=$1; shift
  for i in "$@"; do
    docker manifest inspect "$REGISTRY/rizzoma-$i:$sha" >/dev/null 2>&1 || return 1
  done
}

update_proxy(){   # sha — общий вход двигается только вместе с продом
  local sha=$1 dir=$ROOT/proxy
  mkdir -p "$dir/conf" "$dir/certs"
  git -C "$SRC" show "$sha:deploy/proxy/docker-compose.yml" > "$dir/docker-compose.yml" || return 1
  git -C "$SRC" show "$sha:deploy/proxy/Caddyfile"          > "$dir/conf/Caddyfile"    || return 1
  [ -f "$dir/conf/tls.caddy" ] || echo "tls internal" > "$dir/conf/tls.caddy"
  ( cd "$dir" &&
    IMAGE_TAG=$sha docker compose pull -q &&
    IMAGE_TAG=$sha docker compose up -d --remove-orphans &&
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null )
}

deploy(){   # stack branch [sha] — без sha берётся голова ветки
  local stack=$1 branch=$2 sha=${3:-} dir=$ROOT/$1
  [ -f "$dir/.env" ] || { log "$stack: нет $dir/.env — окружение не настроено"; return 1; }
  if [ -z "$sha" ]; then
    sha=$(git -C "$SRC" rev-parse -q --verify "refs/remotes/origin/$branch") || return 0
  fi
  git -C "$SRC" cat-file -e "$sha^{commit}" 2>/dev/null || { log "$stack: коммита ${sha:0:7} нет в репозитории"; return 1; }
  if [ "$sha" = "$(cat "$dir/.deployed" 2>/dev/null)" ]; then
    log "$stack: ${sha:0:7} уже выкачен"; return 0
  fi

  local images=(bot web)
  [ "$stack" = prod ] && images+=(proxy)
  if ! has_images "$sha" "${images[@]}"; then
    # Ручной режим: тесты не прошли или сборка ещё идёт — молча ждём следующего раза.
    [ -n "$TARGET" ] && { log "$stack: в GHCR нет образов для ${sha:0:7}"; return 1; }
    return 0
  fi

  # Функция вызывается в контексте ||, где set -e не действует, — ошибки
  # проверяем явно: .deployed пишется только после успешного up.
  local prev; prev=$(cut -c1-7 "$dir/.deployed" 2>/dev/null || echo "—")
  log "$stack: выкатываю $branch@${sha:0:7} (было $prev)"
  if [ "$stack" = prod ]; then update_proxy "$sha" || return 1; fi
  git -C "$SRC" show "$sha:deploy/docker-compose.yml" > "$dir/docker-compose.yml" || return 1
  ( cd "$dir" &&
    IMAGE_TAG=$sha docker compose pull -q &&
    IMAGE_TAG=$sha docker compose up -d --remove-orphans ) || return 1
  echo "$sha" > "$dir/.deployed"
  ( cd "$dir" && docker compose ps --format '  {{.Service}}: {{.Status}}' )
  log "$stack: готово ${sha:0:7}"
}

branch_of(){ case $1 in prod) echo main ;; *) echo "$1" ;; esac; }

rc=0
if [ -n "$TARGET" ]; then
  deploy "$TARGET" "$(branch_of "$TARGET")" "$WANT_SHA" || rc=1
else
  for s in prod qa dev; do deploy "$s" "$(branch_of "$s")" || { log "$s: ошибка"; rc=1; }; done
fi
docker image prune -f >/dev/null
exit $rc
