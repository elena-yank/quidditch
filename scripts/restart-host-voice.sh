#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env.voice-host}"
EXAMPLE_ENV="$ROOT_DIR/.env.voice-host.example"
TLS_CONF_EXAMPLE="$ROOT_DIR/turnserver.tls.conf.example"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$EXAMPLE_ENV" ]]; then
    cp "$EXAMPLE_ENV" "$ENV_FILE"
    echo "Created $ENV_FILE from .env.voice-host.example"
    echo "If needed, adjust DATABASE_URL or container names and run the script again."
    exit 1
  fi
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

required_vars=(
  APP_IMAGE
  APP_CONTAINER
  TURN_CONTAINER
  DATABASE_URL
  PORT
  VOICE_TURN_URLS
  VOICE_TURN_USERNAME
  VOICE_TURN_CREDENTIAL
  TURN_CONFIG_PATH
  TURN_CERTS_DIR
)

for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$TURN_CONFIG_PATH")" "$TURN_CERTS_DIR"

if [[ ! -f "$TURN_CONFIG_PATH" ]]; then
  cp "$TLS_CONF_EXAMPLE" "$TURN_CONFIG_PATH"
  echo "Created $TURN_CONFIG_PATH from turnserver.tls.conf.example"
fi

if [[ ! -f "$TURN_CERTS_DIR/fullchain.pem" || ! -f "$TURN_CERTS_DIR/privkey.pem" ]]; then
  echo "Missing TURN TLS certs in $TURN_CERTS_DIR" >&2
  echo "Expected files: fullchain.pem and privkey.pem" >&2
  exit 1
fi

docker build -t "$APP_IMAGE" "$ROOT_DIR"
docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true
docker rm -f "$TURN_CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --restart=always \
  --name "$APP_CONTAINER" \
  --network host \
  -e DATABASE_URL="$DATABASE_URL" \
  -e PORT="$PORT" \
  -e VOICE_STUN_URLS="${VOICE_STUN_URLS:-}" \
  -e VOICE_TURN_URLS="$VOICE_TURN_URLS" \
  -e VOICE_TURN_USERNAME="$VOICE_TURN_USERNAME" \
  -e VOICE_TURN_CREDENTIAL="$VOICE_TURN_CREDENTIAL" \
  "$APP_IMAGE"

docker run -d \
  --restart=always \
  --name "$TURN_CONTAINER" \
  --network host \
  -v "$TURN_CONFIG_PATH:/etc/coturn/turnserver.conf:ro" \
  -v "$TURN_CERTS_DIR:/etc/coturn/certs:ro" \
  coturn/coturn:4.6.3 \
  -c /etc/coturn/turnserver.conf

echo "Voice stack restarted."
