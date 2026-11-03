#!/usr/bin/env bash
set -euo pipefail
# Isolated cloud development only: databases are bound to loopback.
if docker inspect trusteo-postgres >/dev/null 2>&1; then
  docker start trusteo-postgres >/dev/null
else
  docker run -d --name trusteo-postgres -e POSTGRES_USER=trusteo -e POSTGRES_PASSWORD=trusteo_local_only -e POSTGRES_DB=trusteo -p 127.0.0.1:5432:5432 postgres:16-alpine >/dev/null
fi
if docker inspect trusteo-redis >/dev/null 2>&1; then
  docker start trusteo-redis >/dev/null
else
  docker run -d --name trusteo-redis -p 127.0.0.1:6379:6379 redis:7-alpine >/dev/null
fi
for attempt in $(seq 1 30); do
  if docker exec trusteo-postgres pg_isready -U trusteo -d trusteo >/dev/null && [ "$(docker exec trusteo-redis redis-cli ping)" = PONG ]; then
    echo 'PostgreSQL and Redis ready.'
    exit 0
  fi
  sleep 1
done
echo 'Local database services did not become ready.' >&2
exit 1
