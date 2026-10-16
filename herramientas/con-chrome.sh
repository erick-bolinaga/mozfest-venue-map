#!/usr/bin/env bash
# Lanza un Chrome headless, corre lo que se le pase, y se lleva TODO al salir.
#
#     herramientas/con-chrome.sh node herramientas/medir-sheet.js
#
# Existe porque cerrar el Chrome de las pruebas tiene dos formas de salir mal,
# y las dos mordieron el 2026-09-10:
#
#   pkill -x chrome     mata TODOS los Chrome de la máquina, incluido el
#                       navegador en el que estás trabajando, con sus pestañas.
#   kill $!             mata el proceso padre y deja huérfanos los hijos: el
#                       de GPU y un renderer por cada página abierta. Así se
#                       acumularon 150 procesos de Chrome en una sola sesión.
#
# La salida es `setsid`: Chrome arranca en su propio grupo de procesos, y
# `kill -- -PGID` se lleva el grupo entero sin tocar nada de fuera.
set -u
PUERTO=${PUERTO:-9222}
PERFIL=$(mktemp -d /tmp/mozfest-chrome-XXXXXX)

setsid google-chrome --headless=new --remote-debugging-port="$PUERTO" \
  --no-first-run --no-default-browser-check \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --user-data-dir="$PERFIL" about:blank >/dev/null 2>&1 &
CHROME=$!
sleep 1
PGID=$(ps -o pgid= "$CHROME" 2>/dev/null | tr -d ' ')

limpiar() {
  if [ -n "${PGID:-}" ] && [ "$PGID" != "$$" ]; then
    kill -TERM -"$PGID" 2>/dev/null
    sleep 2
    kill -KILL -"$PGID" 2>/dev/null
  fi
  rm -rf "$PERFIL"
}
trap limpiar EXIT INT TERM

# Esperar a que conteste antes de correr nada: `/json/version` es la señal, y
# `/json/new` sólo responde a PUT, así que no sirve para esperar.
listo=no
for _ in $(seq 1 60); do
  if curl -s -m 1 "http://127.0.0.1:$PUERTO/json/version" >/dev/null 2>&1; then listo=si; break; fi
  sleep 0.5
done
if [ "$listo" != si ]; then echo "el Chrome no llegó a contestar en el puerto $PUERTO" >&2; exit 1; fi

"$@"
