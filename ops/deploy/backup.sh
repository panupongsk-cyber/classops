#!/usr/bin/env bash
# Nightly PostgreSQL backup: pg_dump --format=custom, a SHA-256 checksum alongside it, keeping
# the newest 7 daily dumps. Runs pg_dump inside the postgres container over `docker compose exec`
# and streams it to the host, since production never publishes PostgreSQL's port to the host (see
# compose.v2.prod.yml). Per pilot-plan-macmini.md: dumps never enter Git or LifeOS; this script
# only writes to a local, encrypted-disk backup directory.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repository_root/compose.v2.prod.yml"
env_file="${CLASSOPS_ENV_FILE:?Set CLASSOPS_ENV_FILE to the production secrets file}"

compose() {
  docker compose -f "$compose_file" --env-file "$env_file" "$@"
}

backup_dir="${CLASSOPS_BACKUP_DIR:-$HOME/.life-os/runtime/classops/backups}"
keep_count="${CLASSOPS_BACKUP_KEEP_COUNT:-7}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_path="$backup_dir/classops-$timestamp.dump"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

echo "==> Dumping database to $dump_path"
compose exec -T postgres pg_dump \
  --username=classops --dbname=classops --format=custom --no-owner --no-acl \
  > "$dump_path"

sha256sum "$dump_path" > "$dump_path.sha256"
chmod 600 "$dump_path" "$dump_path.sha256"
echo "==> Wrote $(sha256sum -c "$dump_path.sha256")"

echo "==> Rotating: keeping the newest $keep_count dumps"
# shellcheck disable=SC2012
ls -1t "$backup_dir"/classops-*.dump | tail -n "+$((keep_count + 1))" | while read -r stale_dump; do
  echo "removing $stale_dump"
  rm -f "$stale_dump" "$stale_dump.sha256"
done

echo "==> Backup complete: $dump_path"
