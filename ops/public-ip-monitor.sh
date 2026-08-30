#!/usr/bin/env bash
set -euo pipefail

monitor_state_dir="${CLASSOPS_IP_MONITOR_STATE_DIR:-/var/lib/classops/network}"
primary_endpoint="${CLASSOPS_PUBLIC_IP_ENDPOINT_PRIMARY:-https://api.ipify.org}"
secondary_endpoint="${CLASSOPS_PUBLIC_IP_ENDPOINT_SECONDARY:-https://checkip.amazonaws.com}"
alert_webhook="${CLASSOPS_IP_ALERT_WEBHOOK_URL:-}"
state_file="$monitor_state_dir/public-ip"

read_public_ip() {
  curl --fail --silent --show-error --max-time 15 "$1" | tr -d '[:space:]'
}

valid_ipv4() {
  local candidate="$1"
  local octet
  [[ "$candidate" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS='.' read -r -a octets <<< "$candidate"
  for octet in "${octets[@]}"; do
    (( octet >= 0 && octet <= 255 )) || return 1
  done
}

primary_ip="$(read_public_ip "$primary_endpoint")"
secondary_ip="$(read_public_ip "$secondary_endpoint")"
valid_ipv4 "$primary_ip"
valid_ipv4 "$secondary_ip"

if [[ "$primary_ip" != "$secondary_ip" ]]; then
  logger -t classops-ip-monitor "public IP providers disagree"
  exit 1
fi

mkdir -p "$monitor_state_dir"
previous_ip=""
if [[ -f "$state_file" ]]; then
  previous_ip="$(tr -d '[:space:]' < "$state_file")"
fi

if [[ "$primary_ip" == "$previous_ip" ]]; then
  exit 0
fi

if [[ -z "$previous_ip" ]]; then
  temporary_file="$(mktemp "$monitor_state_dir/public-ip.XXXXXX")"
  printf '%s\n' "$primary_ip" > "$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$state_file"
  logger -t classops-ip-monitor "initialized public IP state"
  exit 0
fi

if [[ -z "$alert_webhook" ]]; then
  logger -t classops-ip-monitor "public IP changed but CLASSOPS_IP_ALERT_WEBHOOK_URL is not configured"
  exit 2
fi

host_name="$(hostname -s)"
payload="{\"text\":\"⚠️ ClassOps public IP changed on ${host_name}: ${previous_ip} → ${primary_ip}. Update Brevo Settings → Security → Authorized IPs, then run the SMTP health check.\"}"
curl --fail --silent --show-error --max-time 15 \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  "$alert_webhook" >/dev/null

temporary_file="$(mktemp "$monitor_state_dir/public-ip.XXXXXX")"
printf '%s\n' "$primary_ip" > "$temporary_file"
chmod 600 "$temporary_file"
mv "$temporary_file" "$state_file"
logger -t classops-ip-monitor "public IP change notification delivered"
