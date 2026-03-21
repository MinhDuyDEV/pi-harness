#!/usr/bin/env bash
set -euo pipefail

# Block suspicious remote execution: curl ... | bash
if [[ "${PI_TOOL_NAME:-}" == "bash" ]] && grep -Eiq 'curl.*\|[[:space:]]*bash' <<<"${PI_TOOL_ARGS:-}"; then
  echo "Blocked: detected curl | bash pattern in bash command arguments"
  exit 1
fi
