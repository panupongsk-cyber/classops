#!/usr/bin/env bash
# Disposable-database restore rehearsal per pilot-plan-macmini.md's acceptance checklist: restore
# the newest (or a given) dump into a throwaway database inside the same postgres container,
# report row counts, then drop it. Never touches the real `classops` database.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repository_root/compose.v2.prod.yml"
env_file="${CLASSOPS_ENV_FILE:?Set CLASSOPS_ENV_FILE to the production secrets file}"
backup_dir="${CLASSOPS_BACKUP_DIR:-$HOME/.life-os/runtime/classops/backups}"
disposable_db="classops_restore_rehearsal"

compose() {
  docker compose -f "$compose_file" --env-file "$env_file" "$@"
}

dump_path="${1:-}"
if [[ -z "$dump_path" ]]; then
  # shellcheck disable=SC2012
  dump_path="$(ls -1t "$backup_dir"/classops-*.dump | head -n 1)"
fi
[[ -f "$dump_path" ]] || { echo "Dump not found: $dump_path" >&2; exit 1; }
[[ -f "$dump_path.sha256" ]] && (cd "$(dirname "$dump_path")" && sha256sum -c "$(basename "$dump_path").sha256")

echo "==> Restoring $dump_path into disposable database $disposable_db"
compose exec -T postgres psql -U classops -d classops \
  -c "DROP DATABASE IF EXISTS $disposable_db;" \
  -c "CREATE DATABASE $disposable_db OWNER classops;"

compose exec -T postgres pg_restore \
  --username=classops --dbname="$disposable_db" --no-owner --no-acl \
  < "$dump_path"

echo "==> Row counts in the restored disposable database"
compose exec -T postgres psql -U classops -d "$disposable_db" -c "
  SELECT 'users' AS table_name, count(*) FROM users
  UNION ALL SELECT 'courses', count(*) FROM courses
  UNION ALL SELECT 'sections', count(*) FROM sections
  UNION ALL SELECT 'memberships', count(*) FROM memberships;
"

echo "==> Dropping the disposable database"
compose exec -T postgres psql -U classops -d classops -c "DROP DATABASE $disposable_db;"

echo "==> Restore rehearsal complete"
