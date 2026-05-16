#!/usr/bin/env bash
set -euo pipefail

PI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_VCC_DIR="$PI_DIR/npm/node_modules/@sting8k/pi-vcc"
PATCH_FILE="$PI_DIR/patches/pi-vcc-tui-safe-lines.patch"

if [[ ! -d "$PI_VCC_DIR" ]]; then
  echo "pi-vcc package not installed at $PI_VCC_DIR" >&2
  exit 1
fi

if grep -q "wrapLongLines" "$PI_VCC_DIR/src/core/format.ts"; then
  echo "pi-vcc TUI-safe line patch already applied"
  exit 0
fi

(
  cd "$PI_VCC_DIR"
  git apply "$PATCH_FILE"
)

echo "applied pi-vcc TUI-safe line patch"
