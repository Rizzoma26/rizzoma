#!/usr/bin/env bash
# Подготовка чистого Ubuntu (24.04) под RIZZOMA: Docker, пользователь deploy,
# /opt/rizzoma, скрипт выкатки (его зовёт GitHub Actions по SSH), таймер сертификатов,
# запрет входа по паролю.
# Запуск от root, повторный запуск безопасен (ничего уже настроенного не затирает):
#
#   bash install.sh                          # чистая установка, секреты — по шаблонам
#   bash install.sh --restore backup.tgz     # переезд: секреты, конфиги и сертификаты из бэкапа
#   bash install.sh ... --start              # выкатить окружения и включить продление сертификата
#
# Без --start ничего не запускается: при переезде сначала гасим старый сервер —
# два бота на одном токене мешают друг другу (getUpdates → 409).
set -euo pipefail

REPO=https://github.com/Rizzoma26/rizzoma.git
ROOT=/opt/rizzoma
DOMAIN=rizzoma.ru
RESTORE= START=

while [ $# -gt 0 ]; do
  case $1 in
    --restore) RESTORE=$(realpath "$2"); shift 2 ;;
    --domain)  DOMAIN=$2; shift 2 ;;
    --start)   START=1; shift ;;
    *) echo "неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "нужен root" >&2; exit 1; }
say(){ echo "== $*"; }

say "Docker"
if ! command -v docker >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin git >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1

say "пользователь deploy"
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
usermod -aG docker deploy

say "SSH: только ключи"
printf "PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n" \
  > /etc/ssh/sshd_config.d/00-hardening.conf

if [ -n "$RESTORE" ]; then
  say "восстановление из $RESTORE"
  # Сначала проверяем, что ключи из бэкапа реально есть — иначе после запрета
  # паролей можно остаться без входа.
  tar -tzf "$RESTORE" | grep -qx 'root/.ssh/authorized_keys' || { echo "в бэкапе нет authorized_keys" >&2; exit 1; }
  tar -xzf "$RESTORE" -C /
  chmod 700 /root/.ssh; chmod 600 /root/.ssh/authorized_keys
fi
[ -s /root/.ssh/authorized_keys ] || { echo "в /root/.ssh/authorized_keys пусто — пароли не отключаю" >&2; rm /etc/ssh/sshd_config.d/00-hardening.conf; }
sshd -t && systemctl reload ssh

say "/opt/rizzoma"
install -d -o deploy -g deploy -m 750 "$ROOT"
install -d -o deploy -g deploy "$ROOT/bin" "$ROOT/proxy" "$ROOT/proxy/conf" "$ROOT/proxy/certs"
[ -d "$ROOT/src/.git" ] || sudo -u deploy git clone -q "$REPO" "$ROOT/src"
sudo -u deploy git -C "$ROOT/src" pull -q --ff-only || true
SRC=$ROOT/src

for f in rizzoma-deploy.sh rizzoma-certs.sh rizzoma-backup.sh; do
  install -m 755 -o deploy -g deploy "$SRC/deploy/server/$f" "$ROOT/bin/$f"
done
install -m 644 "$SRC"/deploy/server/rizzoma-*.service "$SRC"/deploy/server/rizzoma-*.timer /etc/systemd/system/
# Таймер выкатки был до перехода на выкатку из GitHub Actions — убираем, если остался.
systemctl disable --now rizzoma-deploy.timer >/dev/null 2>&1 || true
rm -f /etc/systemd/system/rizzoma-deploy.timer
systemctl daemon-reload

# Шаблоны там, где бэкапа не было: секреты придётся вписать руками.
for s in prod qa dev; do
  case $s in prod) host=$DOMAIN; branch=main ;; qa) host=qa.$DOMAIN; branch=qa ;; dev) host=dev.$DOMAIN; branch=dev ;; esac
  install -d -o deploy -g deploy "$ROOT/$s" "$ROOT/$s/public"
  if [ ! -f "$ROOT/$s/.env" ]; then
    { echo "STACK=$s"; echo "BRANCH=$branch"
      sed -e "s|^BOT_TOKEN=.*|BOT_TOKEN=|" -e "s|^APP_URL=.*|APP_URL=https://$host/|" \
          -e "s|^CORS_ORIGIN=.*|CORS_ORIGIN=https://$host|" "$SRC/bot/.env.example" | grep -vE '^\s*(#|$)'
    } > "$ROOT/$s/.env"
    echo "   $s/.env — шаблон, впиши BOT_TOKEN и остальное"
  fi
  if [ ! -f "$ROOT/$s/public/config.js" ]; then
    sed "s|^  apiBase: '[^']*',|  apiBase: 'https://$host',|" "$SRC/config.js" > "$ROOT/$s/public/config.js"
    echo "   $s/public/config.js — из репозитория, впиши bot/app"
  fi
done
if [ ! -f "$ROOT/proxy/.env" ]; then
  printf "PROD_DOMAIN=%s\nQA_DOMAIN=qa.%s\nDEV_DOMAIN=dev.%s\nCERT_DOMAIN=%s\nTIMEWEBCLOUD_AUTH_TOKEN=\n" \
    "$DOMAIN" "$DOMAIN" "$DOMAIN" "$DOMAIN" > "$ROOT/proxy/.env"
  echo "   proxy/.env — шаблон, впиши TIMEWEBCLOUD_AUTH_TOKEN"
fi
[ -f "$ROOT/proxy/conf/tls.caddy" ] || echo "tls internal" > "$ROOT/proxy/conf/tls.caddy"
# Сертификат из бэкапа — сразу в ход, не дожидаясь перевыпуска
if [ -f "$ROOT/proxy/certs/certificates/$DOMAIN.crt" ]; then
  echo "tls /certs/certificates/$DOMAIN.crt /certs/certificates/$DOMAIN.key" > "$ROOT/proxy/conf/tls.caddy"
fi
chown -R deploy:deploy "$ROOT" /home/deploy
[ -d /home/deploy/.ssh ] && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true
chmod 600 "$ROOT"/*/.env

say "проверка"
missing=0
for s in prod qa dev; do grep -q '^BOT_TOKEN=.\+' "$ROOT/$s/.env" || { echo "   нет BOT_TOKEN в $s/.env"; missing=1; }; done
grep -q '^TIMEWEBCLOUD_AUTH_TOKEN=.\+' "$ROOT/proxy/.env" || { echo "   нет TIMEWEBCLOUD_AUTH_TOKEN в proxy/.env"; missing=1; }
[ -f /home/deploy/.docker/config.json ] || { echo "   deploy не залогинен в ghcr.io: sudo -u deploy docker login ghcr.io -u <github-логин>  (classic PAT, read:packages)"; missing=1; }
grep -q 'rizzoma-deploy.sh --ssh' /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "   нет ключа CI в /home/deploy/.ssh/authorized_keys — GitHub Actions не сможет выкатывать (см. DEPLOY.md)"

if [ -n "$START" ]; then
  [ $missing = 0 ] || { echo "не запускаю: заполни то, что выше, и повтори с --start" >&2; exit 1; }
  systemctl enable --now rizzoma-certs.timer
  systemctl start rizzoma-deploy.service
  journalctl -u rizzoma-deploy --since "-5 min" --no-pager -o cat | grep -E "выкатываю|готово|ошибка|уже"
  say "запущено. Дальше выкатывает GitHub Actions; DNS — на IP этого сервера"
else
  say "готово. Запустить: bash install.sh --start"
fi
