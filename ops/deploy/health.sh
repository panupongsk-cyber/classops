#!/usr/bin/env bash
# Reports container health and hits the gateway's same-origin /health path. Exits non-zero if
# anything is unhealthy so it can be used as a cron/monitoring check.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repository_root/compose.v2.prod.yml"
env_file="${CLASSOPS_ENV_FILE:?Set CLASSOPS_ENV_FILE to the production secrets file}"

compose() {
  docker compose -f "$compose_file" --env-file "$env_file" "$@"
}

status=0

echo "==> Container status"
compose ps

for service in postgres api gateway; do
  container_id="$(compose ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    echo "!! $service: not running"
    status=1
    continue
  fi
  health="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || echo "unknown")"
  echo "$service: $health"
  [[ "$health" == "healthy" ]] || status=1
done

echo "==> API health via gateway (same-origin path)"
if ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8080/health; then
  echo "!! gateway did not return a healthy /health response"
  status=1
fi
echo

exit "$status"
