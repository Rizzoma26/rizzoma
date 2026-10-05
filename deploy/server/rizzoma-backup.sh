#!/usr/bin/env bash
# Всё, чего нет в git и без чего не поднять окружения на новом сервере:
# секреты (.env), config.js окружений, сертификат и аккаунт lego, вход в GHCR,
# SSH-ключи root и ключ CI для выкатки (deploy). Пишет tar.gz в stdout — снимать с локальной машины:
#
#   ssh rizzoma /opt/rizzoma/bin/rizzoma-backup.sh > rizzoma-backup-$(date +%F).tgz
#
# В архиве токены ботов, Timeweb и GitHub — хранить как секрет.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "нужен root" >&2; exit 1; }
cd /
paths=(
  opt/rizzoma/proxy/.env
  opt/rizzoma/proxy/certs
  root/.ssh/authorized_keys
  home/deploy/.docker/config.json
  home/deploy/.ssh/authorized_keys
)
for s in prod qa dev; do
  paths+=("opt/rizzoma/$s/.env" "opt/rizzoma/$s/public/config.js")
done
existing=()
for p in "${paths[@]}"; do [ -e "$p" ] && existing+=("$p") || echo "нет $p — пропускаю" >&2; done
tar -czf - "${existing[@]}"
