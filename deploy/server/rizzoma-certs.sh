#!/usr/bin/env bash
# Wildcard-сертификат на CERT_DOMAIN и *.CERT_DOMAIN через lego + DNS-API Timeweb.
# Выпуск при первом запуске, дальше продление за 30 дней до истечения.
# Запускается таймером rizzoma-certs.timer от deploy.
set -euo pipefail

cd /opt/rizzoma/proxy
CERT_DOMAIN=$(sed -n 's/^CERT_DOMAIN=//p' .env)
CRT=certs/certificates/$CERT_DOMAIN.crt
ARGS=(--accept-tos --path /certs --dns timewebcloud -d "$CERT_DOMAIN" -d "*.$CERT_DOMAIN")

if [ -f "$CRT" ]; then
  docker compose run --rm -T certs "${ARGS[@]}" renew --days 30 --no-random-sleep
else
  docker compose run --rm -T certs "${ARGS[@]}" run
fi

echo "tls /certs/certificates/$CERT_DOMAIN.crt /certs/certificates/$CERT_DOMAIN.key" > conf/tls.caddy
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
