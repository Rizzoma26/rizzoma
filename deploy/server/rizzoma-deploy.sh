#!/usr/bin/env bash
# Pull-деплой. GitHub до сервера не достаёт (ни SSH, ни self-hosted раннер),
# поэтому сервер раз в минуту смотрит ветки сам: main → prod, qa → qa, dev → dev.
# Выкатывается коммит, для которого в GHCR уже есть образы, — а они собираются
# только после зелёных тестов. Запускается таймером rizzoma-deploy.timer от deploy.
set -euo pipefail

ROOT=/opt/rizzoma
SRC=$ROOT/src
REPO=https://github.com/Rizzoma26/rizzoma.git
REGISTRY=ghcr.io/rizzoma26

exec 9>"$ROOT/.deploy.lock"
flock -n 9 || exit 0

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

deploy(){   # stack branch
  local stack=$1 branch=$2 dir=$ROOT/$1 sha
  [ -f "$dir/.env" ] || return 0
  sha=$(git -C "$SRC" rev-parse -q --verify "refs/remotes/origin/$branch") || return 0
  [ "$sha" = "$(cat "$dir/.deployed" 2>/dev/null)" ] && return 0

  local images=(bot web)
  [ "$stack" = prod ] && images+=(proxy)
  has_images "$sha" "${images[@]}" || return 0   # тесты не прошли или сборка ещё идёт

  # Функция вызывается в контексте ||, где set -e не действует, — ошибки
  # проверяем явно: .deployed пишется только после успешного up.
  log "$stack: выкатываю $branch@${sha:0:7}"
  if [ "$stack" = prod ]; then update_proxy "$sha" || return 1; fi
  git -C "$SRC" show "$sha:deploy/docker-compose.yml" > "$dir/docker-compose.yml" || return 1
  ( cd "$dir" &&
    IMAGE_TAG=$sha docker compose pull -q &&
    IMAGE_TAG=$sha docker compose up -d --remove-orphans ) || return 1
  echo "$sha" > "$dir/.deployed"
  log "$stack: готово ${sha:0:7}"
}

rc=0
deploy prod main || { log "prod: ошибка"; rc=1; }
deploy qa   qa   || { log "qa: ошибка";   rc=1; }
deploy dev  dev  || { log "dev: ошибка";  rc=1; }
docker image prune -f >/dev/null
exit $rc
