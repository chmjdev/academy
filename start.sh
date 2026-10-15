#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="academy"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"
RUN_DIR="$PROJECT_DIR/data/run"
PID_FILE="$RUN_DIR/${PROJECT_NAME}.pid"
LOG_FILE="$RUN_DIR/${PROJECT_NAME}.log"

usage() {
  echo "usage: ./start.sh dev | uat | prod | stop | restart | logs | status | clean" >&2
  exit 2
}

jcds_port() {
  local stage="$1" port
  [ -f jcds.config ] || { echo "$PROJECT_NAME: jcds.config missing" >&2; exit 2; }
  port="$(sed -n '/"ports"[[:space:]]*:/,/}/p' jcds.config | sed -n "s/.*\"$stage\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" | head -n1)"
  if [ -z "$port" ] || [ "$port" = "0" ]; then
    echo "$PROJECT_NAME: no usable ports.$stage in jcds.config" >&2
    exit 2
  fi
  echo "$port"
}

jcds_env_file() {
  local stage="${1:-dev}"
  local f="/etc/jcds/env/${PROJECT_NAME}-${stage}.env"
  if [ "$stage" != "dev" ] && [ -r "$f" ] && [ -s "$f" ]; then
    echo "$f"
  elif [ -f .env ]; then
    echo .env
  fi
}

ensure_env() {
  if [ ! -f .env ]; then
    cat <<EOF > .env
NODE_ENV=development
PORT=3155
ACADEMY_HOST=127.0.0.1
ACADEMY_TITLE="Govtech Academy"
EOF
    chmod 600 .env
  fi
}

stop_grace() {
  local g
  g="$(sed -n 's/.*"grace_period_sec"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' jcds.config 2>/dev/null | head -n1)"
  echo "${g:-30}"
}

is_container_running() {
  [ "$(docker container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]
}

stop_container() {
  local name="$1" grace waited=0
  is_container_running "$name" || return 0
  grace="$(stop_grace)"
  docker kill --signal=SIGTERM "$name" >/dev/null 2>&1 || true
  while [ "$waited" -lt "$grace" ] && is_container_running "$name"; do
    sleep 1
    waited=$((waited + 1))
  done
  is_container_running "$name" || return 0
  docker kill "$name" >/dev/null 2>&1 || true
}

remove_container() {
  local name="$1"
  stop_container "$name"
  docker rm -f "$name" >/dev/null 2>&1 || true
}

start_dev() {
  local port
  port="$(jcds_port dev)"
  ensure_env
  mkdir -p "$RUN_DIR"

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "$PROJECT_NAME dev is already running (PID $(cat "$PID_FILE"))"
    return 0
  fi

  echo "==> starting $PROJECT_NAME dev on port $port"
  export PORT="$port"
  export NODE_ENV="development"
  export ACADEMY_HOST="127.0.0.1"

  nohup node src/server.js >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "$PROJECT_NAME dev started (PID $(cat "$PID_FILE")) on http://127.0.0.1:$port"
}

start_prod() {
  local stage="prod" port env_file image
  port="$(jcds_port "$stage")"
  env_file="$(jcds_env_file "$stage")"

  echo "==> starting $PROJECT_NAME $stage on port $port (Docker)"
  remove_container "$PROJECT_NAME-$stage"

  local env_args=()
  if [ -n "$env_file" ] && [ -f "$env_file" ]; then
    env_args+=(--env-file "$env_file")
  fi

  if docker image inspect "$PROJECT_NAME-$stage:latest" >/dev/null 2>&1; then
    image="$PROJECT_NAME-$stage:latest"
  else
    echo "==> building $PROJECT_NAME:$stage image"
    docker build -t "$PROJECT_NAME:$stage" .
    image="$PROJECT_NAME:$stage"
  fi

  docker run -d \
    --name "$PROJECT_NAME-$stage" \
    --init \
    --stop-timeout "$(stop_grace)" \
    --restart unless-stopped \
    -p "127.0.0.1:${port}:${port}" \
    -e "PORT=${port}" \
    -e "NODE_ENV=production" \
    -e "ACADEMY_HOST=0.0.0.0" \
    "${env_args[@]}" \
    "$image" >/dev/null

  echo "$PROJECT_NAME $stage listening on 127.0.0.1:$port"
}

stop_all() {
  echo "==> stopping $PROJECT_NAME"
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  for st in dev uat prod; do
    remove_container "$PROJECT_NAME-$st"
  done
  echo "$PROJECT_NAME stopped"
}

status() {
  local port
  port="$(jcds_port dev)"
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "$PROJECT_NAME dev is running (PID $(cat "$PID_FILE")) on port $port"
  elif is_container_running "$PROJECT_NAME-prod"; then
    echo "$PROJECT_NAME-prod container is running on port $(jcds_port prod)"
  else
    echo "$PROJECT_NAME is stopped"
  fi
}

logs() {
  if is_container_running "$PROJECT_NAME-prod"; then
    docker logs -f --tail=100 "$PROJECT_NAME-prod"
  elif [ -f "$LOG_FILE" ]; then
    tail -n 100 -f "$LOG_FILE"
  else
    echo "No logs found for $PROJECT_NAME"
  fi
}

clean() {
  stop_all
  rm -rf "$RUN_DIR"
  echo "$PROJECT_NAME cleaned"
}

cmd="${1:-}"
case "$cmd" in
  dev)
    start_dev
    ;;
  prod)
    start_prod
    ;;
  uat)
    start_prod
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_dev
    ;;
  status)
    status
    ;;
  logs)
    logs
    ;;
  clean)
    clean
    ;;
  *)
    usage
    ;;
esac
