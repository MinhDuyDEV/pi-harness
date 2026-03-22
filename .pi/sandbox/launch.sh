#!/usr/bin/env bash
# Launch a command under pikit sandbox
# Usage: ./launch.sh <command> [args...]
#
# Example: ./launch.sh bash -c "ls -la"
# Example: ./launch.sh node -e "console.log(1)"
#
# Sandbox mode: workspace-write
# Generated: 2026-03-22T04:04:41.057Z

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILE="${SCRIPT_DIR}/profile.sb"

if [ ! -f "$PROFILE" ]; then
  echo "Error: Seatbelt profile not found at $PROFILE" >&2
  exit 1
fi

if ! command -v sandbox-exec &>/dev/null; then
  echo "Warning: sandbox-exec not found (not macOS?). Running without sandbox." >&2
  exec "$@"
fi

exec sandbox-exec -f "$PROFILE" "$@"
