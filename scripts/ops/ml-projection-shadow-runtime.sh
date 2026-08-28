#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-status}"
PROJECT_DIR="${W_ECOMMERCE_PROJECT_DIR:-/opt/w-ecommerce}"
RUNTIME_ENV="${MERCADO_LIVRE_PROJECTION_RUNTIME_ENV_FILE:-/opt/w-ecommerce-runtime/ml-projection-shadow.env}"
COMPOSE=(docker compose --env-file "$PROJECT_DIR/.env.production" -f "$PROJECT_DIR/docker-compose.yml")

fail() {
  printf 'ERROR_CODE=%s\n' "$1" >&2
  exit 1
}

container_state() {
  local container="$1"
  docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.Image}}' "$container" 2>/dev/null || printf 'absent|absent|0|none\n'
}

container_commit() {
  local container="$1"
  docker exec "$container" node -e 'const fs=require("fs");const p="/app/.deploy-manifest.json";console.log(fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")).commitSha:"missing")' 2>/dev/null || printf 'absent\n'
}

assert_no_duplicates() {
  local service count
  for service in ml-projection-worker ml-projection-scheduler; do
    count="$(docker ps -a --filter "label=com.docker.compose.service=$service" --format '{{.ID}}' | wc -l | tr -d ' ')"
    [ "$count" -le 1 ] || fail PROJECTION_RUNTIME_DUPLICATE_CONTAINER
  done
}

require_runtime_env() {
  [ -f "$RUNTIME_ENV" ] || fail PROJECTION_RUNTIME_ENV_MISSING
  [ "$(stat -c '%a' "$RUNTIME_ENV")" = "600" ] || fail PROJECTION_RUNTIME_ENV_PERMISSIONS_INVALID
  if grep -Eiq '(^|_)(TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE|API_KEY)=' "$RUNTIME_ENV"; then
    fail PROJECTION_RUNTIME_ENV_CONTAINS_SECRET
  fi
}

compose_runtime() {
  MERCADO_LIVRE_PROJECTION_RUNTIME_ENV_FILE="$RUNTIME_ENV" "${COMPOSE[@]}" "$@"
}

runtime_state() {
  compose_runtime --profile ml-projection-worker run --rm --no-deps \
    --entrypoint ./node_modules/.bin/tsx ml-projection-worker \
    scripts/ops/ml-projection-runtime-state.ts "$1"
}

wait_healthy() {
  local container="$1"
  local attempt
  for attempt in $(seq 1 40); do
    if [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)" = "healthy" ]; then
      return 0
    fi
    sleep 3
  done
  fail PROJECTION_RUNTIME_HEALTH_TIMEOUT
}

preflight() {
  require_runtime_env
  [ -f "$PROJECT_DIR/.deploy-manifest.json" ] || fail PROJECTION_RUNTIME_MANIFEST_MISSING
  docker inspect w-ecommerce-app >/dev/null 2>&1 || fail PROJECTION_RUNTIME_APP_MISSING
  docker inspect w-ecommerce-postgres >/dev/null 2>&1 || fail PROJECTION_RUNTIME_POSTGRES_MISSING
  docker inspect w-ecommerce-redis >/dev/null 2>&1 || fail PROJECTION_RUNTIME_REDIS_MISSING
  assert_no_duplicates
  [ "$(docker inspect --format '{{.State.Health.Status}}' w-ecommerce-postgres)" = "healthy" ] || fail PROJECTION_RUNTIME_POSTGRES_UNHEALTHY
  [ "$(docker inspect --format '{{.State.Health.Status}}' w-ecommerce-redis)" = "healthy" ] || fail PROJECTION_RUNTIME_REDIS_UNHEALTHY
  [ "$(docker inspect --format '{{.Image}}' w-ecommerce-app)" = "$(docker image inspect --format '{{.Id}}' w-ecommerce-app:latest)" ] || fail PROJECTION_RUNTIME_IMAGE_SKEW
  runtime_state preflight
}

start_runtime() {
  preflight
  [ "$(container_state w-ecommerce-ml-projection-worker | cut -d'|' -f1)" = "absent" ] || fail PROJECTION_WORKER_ALREADY_EXISTS
  [ "$(container_state w-ecommerce-ml-projection-scheduler | cut -d'|' -f1)" = "absent" ] || fail PROJECTION_SCHEDULER_ALREADY_EXISTS
  compose_runtime --profile ml-projection-worker up -d --no-deps ml-projection-worker
  wait_healthy w-ecommerce-ml-projection-worker
  runtime_state preflight
  compose_runtime --profile ml-projection-scheduler up -d --no-deps ml-projection-scheduler
  wait_healthy w-ecommerce-ml-projection-scheduler
  status_runtime
}

stop_runtime() {
  compose_runtime --profile ml-projection-scheduler stop -t 120 ml-projection-scheduler || true
  compose_runtime --profile ml-projection-scheduler rm -f ml-projection-scheduler || true
  runtime_state stop-check
  compose_runtime --profile ml-projection-worker stop -t 120 ml-projection-worker || true
  compose_runtime --profile ml-projection-worker rm -f ml-projection-worker || true
  status_runtime
}

status_runtime() {
  require_runtime_env
  printf 'WORKER_STATE=%s\n' "$(container_state w-ecommerce-ml-projection-worker)"
  printf 'SCHEDULER_STATE=%s\n' "$(container_state w-ecommerce-ml-projection-scheduler)"
  printf 'APP_IMAGE=%s\n' "$(docker inspect --format '{{.Image}}' w-ecommerce-app 2>/dev/null || printf absent)"
  printf 'APP_COMMIT=%s\n' "$(container_commit w-ecommerce-app)"
  printf 'WORKER_COMMIT=%s\n' "$(container_commit w-ecommerce-ml-projection-worker)"
  printf 'SCHEDULER_COMMIT=%s\n' "$(container_commit w-ecommerce-ml-projection-scheduler)"
  if [ "$(container_state w-ecommerce-ml-projection-worker | cut -d'|' -f1)" = "running" ]; then
    docker exec w-ecommerce-ml-projection-worker ./node_modules/.bin/tsx scripts/workers/mercado-livre-projection-health.ts worker 45
  fi
  if [ "$(container_state w-ecommerce-ml-projection-scheduler | cut -d'|' -f1)" = "running" ]; then
    docker exec w-ecommerce-ml-projection-scheduler ./node_modules/.bin/tsx scripts/workers/mercado-livre-projection-health.ts scheduler 150
  fi
  runtime_state status
}

case "$ACTION" in
  preflight) preflight ;;
  start) start_runtime ;;
  status) status_runtime ;;
  stop) stop_runtime ;;
  *) fail PROJECTION_RUNTIME_ACTION_INVALID ;;
esac
