#!/usr/bin/env bash
# Idempotent deploy: build images, run migrations, start (or restart) the stack, wait for health.
# Never touches DNS, Tailscale Serve, or anything outside the Compose project itself — those stay
# separately gated per pilot-plan-macmini.md.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repository_root/compose.v2.prod.yml"
env_file="${CLASSOPS_ENV_FILE:?Set CLASSOPS_ENV_FILE to the production secrets file (e.g. ~/.life-os/secrets/classops.env)}"

compose() {
  docker compose -f "$compose_file" --env-file "$env_file" "$@"
}

echo "==> Building images"
compose build

echo "==> Starting PostgreSQL and waiting for it to be healthy"
compose up -d postgres
compose up --wait postgres

echo "==> Running migrations"
compose run --rm migrate

echo "==> Starting API and gateway"
compose up -d api gateway
compose up --wait api gateway

echo "==> Deploy complete"
compose ps
