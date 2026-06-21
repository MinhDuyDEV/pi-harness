#!/usr/bin/env bash
# Test the rewind extension's session_before_tree picker.
#
# Run from a directory that has pi session history.

set -e

LOG_FILE="${1:-/tmp/pi-rewind-test.log}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Scope the kill: only kill pi RPC processes whose cwd is inside this repo.
# This avoids killing unrelated pi instances on shared machines.
PIDS=$(pgrep -f "pi --mode rpc" || true)
if [ -n "$PIDS" ]; then
  for pid in $PIDS; do
    cwd=$(lsof -a -p "$pid" -d cwd -F n 2>/dev/null | sed -n 's/^n//p' || true)
    case "$cwd" in
      "$REPO_ROOT"|"$REPO_ROOT"/*)
        kill "$pid" 2>/dev/null || true
        ;;
    esac
  done
fi
sleep 1

FIFO=$(mktemp -u)
mkfifo "$FIFO"
exec 3<>"$FIFO"
rm "$FIFO"

# Run pi in this directory, no --cwd flag
pi --mode rpc <&3 >"$LOG_FILE" 2>&1 &
PI_PID=$!

sleep 3

# Try the /tree command via the slash form
echo '{"type":"prompt","text":"/tree"}' >&3
sleep 5

# Also try sending a tree command directly
echo '{"type":"command","command":"/tree"}' >&3
sleep 3

echo '{"type":"abort"}' >&3
sleep 1
kill "$PI_PID" 2>/dev/null || true
wait "$PI_PID" 2>/dev/null || true
exec 3<&-

echo "=== rewind-debug output ==="
grep -E "rewind-debug" "$LOG_FILE" || echo "(no rewind-debug lines captured)"

echo
echo "=== errors and warnings ==="
grep -iE "error|warn|failed" "$LOG_FILE" | head -20

echo
echo "=== last 20 lines of log ==="
tail -20 "$LOG_FILE"
