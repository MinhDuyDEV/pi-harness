#!/usr/bin/env bash
set -euo pipefail

# Enforce conventional commits (subset)
msg="${PI_COMMIT_MSG:-}"
if [[ -z "$msg" ]]; then
  echo "Blocked: commit message is missing (-m/--message)."
  echo "Expected format: <type>(scope): <subject>"
  exit 1
fi

if ! grep -Eq '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: .+' <<<"$msg"; then
  echo "Blocked: commit message is not Conventional Commits compliant."
  echo "Got: $msg"
  echo "Expected: feat(parser): add support for X"
  exit 1
fi

exit 0
