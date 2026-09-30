#!/usr/bin/env bash
# Restart the built API in the background (logs: /tmp/api.log, pid: /tmp/api.pid). Extra env vars pass through.
cd "$(dirname "$0")/.."
[ -f /tmp/api.pid ] && kill "$(cat /tmp/api.pid)" 2>/dev/null
sleep 1
nohup node dist/main.js > /tmp/api.log 2>&1 &
echo $! > /tmp/api.pid
for i in $(seq 1 30); do curl -sf localhost:${PORT:-3000}/health >/dev/null && echo "api up (pid $(cat /tmp/api.pid))" && exit 0; sleep 0.5; done
echo "api failed to start"; tail -20 /tmp/api.log; exit 1
