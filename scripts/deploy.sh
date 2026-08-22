#!/usr/bin/env bash
# Deploy MDA through the moss-dev-2 SSH alias, with a local fallback.
set -euo pipefail

readonly SSH_HOST="moss-dev-2"
readonly REMOTE_DIR="${MDA_REMOTE_DIR:-/srv/mda}"
readonly MDA_PORT="${MDA_PORT:-8356}"
readonly MDA_BIND_ADDRESS="${MDA_BIND_ADDRESS:-127.0.0.1}"
readonly MDA_AGENT_SCALE="${MDA_AGENT_SCALE:-3}"
readonly MDA_BUILD_TIMEOUT="${MDA_BUILD_TIMEOUT:-900}"
readonly MDA_DEPLOY_TIMEOUT="${MDA_DEPLOY_TIMEOUT:-300}"
readonly LOCAL_ENV="${LOCAL_ENV:-.env}"

info() { printf '\033[1;36m[mda]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[mda]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[mda]\033[0m %s\n' "$*" >&2; exit 1; }

validate_settings() {
  [[ "$REMOTE_DIR" =~ ^/[a-zA-Z0-9._/-]+$ ]] ||
    die "MDA_REMOTE_DIR must be an absolute path without spaces"
  [[ "$MDA_PORT" =~ ^[0-9]+$ ]] && ((MDA_PORT >= 1 && MDA_PORT <= 65535)) ||
    die "MDA_PORT must be between 1 and 65535"
  [[ "$MDA_AGENT_SCALE" =~ ^[0-9]+$ ]] && ((MDA_AGENT_SCALE >= 1)) ||
    die "MDA_AGENT_SCALE must be a positive integer"
  [[ "$MDA_BUILD_TIMEOUT" =~ ^[0-9]+$ ]] && ((MDA_BUILD_TIMEOUT >= 1)) ||
    die "MDA_BUILD_TIMEOUT must be a positive integer"
  [[ "$MDA_DEPLOY_TIMEOUT" =~ ^[0-9]+$ ]] && ((MDA_DEPLOY_TIMEOUT >= 1)) ||
    die "MDA_DEPLOY_TIMEOUT must be a positive integer"
}

server_reachable() {
  ssh -o BatchMode=yes -o ConnectTimeout=6 "$SSH_HOST" true 2>/dev/null
}

ensure_local_secrets() {
  if [[ ! -f "$LOCAL_ENV" ]]; then
    command -v openssl >/dev/null || die "openssl is required to generate $LOCAL_ENV"
    info "generating $LOCAL_ENV with random deployment secrets"
    umask 077
    {
      printf 'MDA_PORT=%s\n' "$MDA_PORT"
      printf 'MDA_BIND_ADDRESS=%s\n' "$MDA_BIND_ADDRESS"
      printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 16)"
      printf 'REDIS_PASSWORD=%s\n' "$(openssl rand -hex 16)"
      printf 'MINIO_ACCESS_KEY=%s\n' "$(openssl rand -hex 12)"
      printf 'MINIO_SECRET_KEY=%s\n' "$(openssl rand -hex 32)"
      printf 'S3_BUCKET=mda-artifacts\n'
      printf 'INTERNAL_AGENT_TOKEN=%s\n' "$(openssl rand -hex 32)"
      printf 'MDA_ACCESS_PASSWORD=%s\n' "$(openssl rand -hex 16)"
      printf 'MDA_PREVIEW_SIGNING_KEY=%s\n' "$(openssl rand -hex 32)"
      printf 'LLM_BASE_URL=%s\n' "${LLM_BASE_URL:-https://api.deepseek.com/v1}"
      printf 'LLM_MODEL_NAME=%s\n' "${LLM_MODEL_NAME:-deepseek-chat}"
    } >"$LOCAL_ENV"
  else
    info "using existing $LOCAL_ENV"
  fi
  chmod 0600 "$LOCAL_ENV"
  command -v openssl >/dev/null || die "openssl is required to manage $LOCAL_ENV"
  if ! grep -q '^MINIO_ACCESS_KEY=' "$LOCAL_ENV"; then
    printf 'MINIO_ACCESS_KEY=%s\n' "$(openssl rand -hex 12)" >>"$LOCAL_ENV"
  fi
  if ! grep -q '^MINIO_SECRET_KEY=' "$LOCAL_ENV"; then
    printf 'MINIO_SECRET_KEY=%s\n' "$(openssl rand -hex 32)" >>"$LOCAL_ENV"
  fi
  if ! grep -q '^S3_BUCKET=' "$LOCAL_ENV"; then
    printf 'S3_BUCKET=mda-artifacts\n' >>"$LOCAL_ENV"
  fi
  if ! grep -q '^MDA_PREVIEW_SIGNING_KEY=' "$LOCAL_ENV"; then
    printf 'MDA_PREVIEW_SIGNING_KEY=%s\n' "$(openssl rand -hex 32)" >>"$LOCAL_ENV"
  fi

  mkdir -p var/secrets
  chmod 700 var/secrets
  if [[ ! -e var/secrets/model_api_key ]]; then
    umask 077
    printf '%s' "${MDA_MODEL_API_KEY:-${DEEPSEEK_API_KEY:-}}" >var/secrets/model_api_key
  fi
  # Compose bind-mounts file-backed secrets without changing their mode. The
  # private parent directory protects the host copy; read permission lets the
  # non-root Agent read the mounted file inside its container.
  chmod 0444 var/secrets/model_api_key
  if [[ ! -s var/secrets/model_api_key ]]; then
    warn "model API key is empty; configure var/secrets/model_api_key before using Agent chat"
  fi
}

bootstrap_remote_secrets() {
  if ssh "$SSH_HOST" "test -f '$REMOTE_DIR/.env'"; then
    info "preserving existing server .env"
  else
    info "bootstrapping server .env"
    ssh "$SSH_HOST" "umask 077; cat > '$REMOTE_DIR/.env'" <"$LOCAL_ENV"
  fi
  awk -F= '
    $1 == "MINIO_ACCESS_KEY" ||
    $1 == "MINIO_SECRET_KEY" ||
    $1 == "S3_BUCKET" ||
    $1 == "MDA_PREVIEW_SIGNING_KEY" { print }
  ' "$LOCAL_ENV" | ssh "$SSH_HOST" \
    "while IFS= read -r line; do key=\"\${line%%=*}\"; grep -q \"^\${key}=\" '$REMOTE_DIR/.env' || printf '%s\\n' \"\$line\" >> '$REMOTE_DIR/.env'; done"
  ssh "$SSH_HOST" "chmod 0600 '$REMOTE_DIR/.env'"

  if ssh "$SSH_HOST" "test -f '$REMOTE_DIR/var/secrets/model_api_key'"; then
    info "preserving existing server model credential"
  else
    info "bootstrapping server model credential"
    ssh "$SSH_HOST" \
      "umask 077; cat > '$REMOTE_DIR/var/secrets/model_api_key'" \
      <var/secrets/model_api_key
  fi
  ssh "$SSH_HOST" \
    "chmod 700 '$REMOTE_DIR/var/secrets' && chmod 0444 '$REMOTE_DIR/var/secrets/model_api_key'"
}

sync_sources() {
  command -v rsync >/dev/null || die "rsync is required for server deployment"
  info "syncing sources to $SSH_HOST:$REMOTE_DIR"
  ssh "$SSH_HOST" "mkdir -p '$REMOTE_DIR/var/secrets' && chmod 700 '$REMOTE_DIR/var/secrets'"
  rsync -az --delete \
    --exclude=.git \
    --exclude=node_modules \
    --exclude='**/node_modules' \
    --exclude=var \
    --exclude=coverage \
    --exclude=dist \
    --exclude=.DS_Store \
    --include=.env.example \
    --exclude=.env \
    --exclude='.env.*' \
    --exclude=mda.toml \
    ./ "$SSH_HOST:$REMOTE_DIR/"
}

compose_up() {
  docker compose build --pull
  docker compose up -d --remove-orphans --wait \
    --wait-timeout "$MDA_DEPLOY_TIMEOUT" \
    --scale agent="$MDA_AGENT_SCALE"
}

deploy_local() {
  ensure_local_secrets
  info "building and starting all Compose services locally on port $MDA_PORT"
  compose_up
  info "local stack is ready at http://127.0.0.1:$MDA_PORT"
}

deploy_server() {
  server_reachable ||
    die "cannot reach '$SSH_HOST'; use make deploy-local to deploy on this computer"
  ensure_local_secrets
  sync_sources
  bootstrap_remote_secrets
  info "building and starting all Compose services on $SSH_HOST"
  if ! ssh "$SSH_HOST" \
    "flock -n /tmp/mda-deploy.lock -c \"cd '$REMOTE_DIR' && timeout --foreground '$MDA_BUILD_TIMEOUT' docker compose build --pull && docker compose up -d --remove-orphans --wait --wait-timeout '$MDA_DEPLOY_TIMEOUT' --scale agent='$MDA_AGENT_SCALE'\""; then
    die "server Compose deployment failed; inspect it with make status and make logs"
  fi
  info "server stack is ready on port $MDA_PORT"
  health_server
}

remote_compose() {
  local command="cd '$REMOTE_DIR' && docker compose"
  local argument
  for argument in "$@"; do
    printf -v argument ' %q' "$argument"
    command+="$argument"
  done
  ssh "$SSH_HOST" "$command"
}

use_server_or_local() {
  local operation="$1"
  shift
  if server_reachable; then
    remote_compose "$@"
  else
    warn "'$SSH_HOST' is unreachable; running $operation against the local stack"
    docker compose "$@"
  fi
}

health_server() {
  remote_compose exec -T main bun -e \
    "const r=await fetch('http://127.0.0.1:8080/health/ready'); if(!r.ok) process.exit(1); console.log(await r.text())"
}

health() {
  if server_reachable; then
    health_server
  else
    warn "'$SSH_HOST' is unreachable; checking the local stack"
    docker compose exec -T main bun -e \
      "const r=await fetch('http://127.0.0.1:8080/health/ready'); if(!r.ok) process.exit(1); console.log(await r.text())"
  fi
}

validate_settings
command="${1:-deploy}"
shift || true
case "$command" in
  deploy)
    if server_reachable; then
      info "'$SSH_HOST' is reachable; deploying to the server"
      deploy_server
    else
      warn "'$SSH_HOST' is unreachable; deploying on this computer"
      deploy_local
    fi
    ;;
  deploy-server) deploy_server ;;
  deploy-local) deploy_local ;;
  status) use_server_or_local status ps ;;
  health) health ;;
  logs) use_server_or_local logs logs --tail=100 -f "$@" ;;
  down) use_server_or_local down down ;;
  *) die "unknown command '$command' (deploy, deploy-server, deploy-local, status, health, logs, down)" ;;
esac
