#!/bin/zsh
# Запуск визуализатора: локальный сервер + браузер.
# Сервер живёт, пока живёт этот процесс. Лог: ~/Library/Logs/noisefield.log

DIR="${0:A:h}"          # каталог самого скрипта, куда бы его ни положили
PORT=5180
URL="http://127.0.0.1:$PORT/noisefield.html"
LOG="$HOME/Library/Logs/noisefield.log"

log(){ print -r -- "$(date '+%F %T') $*" >> "$LOG" }
die(){ log "ОШИБКА: $*"; /usr/bin/osascript -e "display alert \"Noisefield\" message \"$*\"" >/dev/null 2>&1; exit 1 }

log "запуск"

PY=""
for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  [ -x "$c" ] && PY="$c" && break
done
[ -z "$PY" ] && die "Нет python3. Поставь Xcode Command Line Tools: xcode-select --install"
[ -f "$DIR/noisefield.html" ] && : || die "Не нашёл $DIR/noisefield.html"

# Сервер уже поднят прошлым запуском — просто открываем вкладку.
if /usr/bin/nc -z 127.0.0.1 $PORT 2>/dev/null; then
  log "сервер уже на $PORT, открываю вкладку"
  /usr/bin/open "$URL" || die "Не смог открыть браузер"
  exit 0
fi

cd "$DIR" || die "Не смог зайти в $DIR"
"$PY" -m http.server $PORT --bind 127.0.0.1 >> "$LOG" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; log "остановлен"' EXIT INT TERM

up=0
for i in {1..60}; do
  /usr/bin/nc -z 127.0.0.1 $PORT 2>/dev/null && up=1 && break
  sleep 0.1
done
[ $up -eq 1 ] || die "Сервер не поднялся на порту $PORT"

log "сервер $SRV на $PORT, открываю $URL"
/usr/bin/open "$URL" || die "Не смог открыть браузер"
wait $SRV
