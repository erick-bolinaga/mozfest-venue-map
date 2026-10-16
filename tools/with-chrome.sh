#!/usr/bin/env bash
# Launches a headless Chrome, runs whatever it is given, and takes ALL of it
# away on exit.
#
#     tools/with-chrome.sh node tools/check-viewer.js
#     CHROME_PORT=9223 tools/with-chrome.sh node tools/check-routes.js
#
# It exists because closing the test Chrome has two ways of going wrong, and
# both bit on 2026-09-10:
#
#   pkill -x chrome     kills EVERY Chrome on the machine, including the
#                       browser you are working in, with its tabs.
#   kill $!             kills the parent process and orphans the children: the
#                       GPU one and a renderer per open page. That is how 150
#                       Chrome processes piled up in a single session.
#
# The way out is `setsid`: Chrome starts in its own process group, and
# `kill -- -PGID` takes the whole group without touching anything outside.
set -u
CHROME_PORT=${CHROME_PORT:-9222}
PROFILE=$(mktemp -d /tmp/mozfest-chrome-XXXXXX)

setsid google-chrome --headless=new --remote-debugging-port="$CHROME_PORT" \
  --no-first-run --no-default-browser-check \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --user-data-dir="$PROFILE" about:blank >/dev/null 2>&1 &
CHROME=$!
sleep 1
PGID=$(ps -o pgid= "$CHROME" 2>/dev/null | tr -d ' ')

cleanup() {
  if [ -n "${PGID:-}" ] && [ "$PGID" != "$$" ]; then
    kill -TERM -"$PGID" 2>/dev/null
    sleep 2
    kill -KILL -"$PGID" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT INT TERM

# Wait until it answers before running anything: `/json/version` is the signal,
# and `/json/new` only answers PUT, so it is no use for waiting.
ready=no
for _ in $(seq 1 60); do
  if curl -s -m 1 "http://127.0.0.1:$CHROME_PORT/json/version" >/dev/null 2>&1; then ready=yes; break; fi
  sleep 0.5
done
if [ "$ready" != yes ]; then echo "Chrome never answered on port $CHROME_PORT" >&2; exit 1; fi

"$@"
