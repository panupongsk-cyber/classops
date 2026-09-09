#!/usr/bin/env bash
# Mechanical part of the rollback procedure in pilot-plan-macmini.md: stop the running stack
# without deleting volumes, repoint /opt/classops/current at a previous release directory, and
# restart from there. Does not touch Tailscale Serve, DNS, or delete the database volume — those
# stay separately gated / manual per that document's Rollback section.
#
# Assumes the proposed host layout:
#   /opt/classops/releases/<source-commit>/   (this repository checked out at that commit)
#   /opt/classops/current -> releases/<source-commit>
set -euo pipefail

releases_root="${CLASSOPS_RELEASES_ROOT:-/opt/classops/releases}"
current_link="${CLASSOPS_CURRENT_LINK:-/opt/classops/current}"
env_file="${CLASSOPS_ENV_FILE:?Set CLASSOPS_ENV_FILE to the production secrets file}"

target_commit="${1:?Usage: rollback.sh <previous-known-good-source-commit>}"
target_release="$releases_root/$target_commit"
[[ -d "$target_release" ]] || { echo "No release directory at $target_release" >&2; exit 1; }

current_compose="$current_link/compose.v2.prod.yml"
if [[ -e "$current_compose" ]]; then
  echo "==> Stopping the running stack (volumes preserved)"
  docker compose -f "$current_compose" --env-file "$env_file" down
else
  echo "==> No running stack found at $current_link; continuing"
fi

echo "==> Repointing $current_link -> $target_release"
ln -sfn "$target_release" "$current_link"

echo "==> Starting the previous release"
"$current_link/ops/deploy/deploy.sh"

echo "==> Rollback complete. Re-run ops/deploy/health.sh and the acceptance subset of phase1-qa-spec.md section 4."
