#!/usr/bin/env bash
# Set up an isolated test environment for the rewind extension.
#
# This:
#   1. Creates /tmp/rewind-isolated with a fresh git repo
#   2. Installs ONLY the rewind extension
#   3. Disables all other extensions and packages
#   4. Launches pi in that directory
#
# The rewind extension's debug logs go to stderr. Filter with:
#   pi 2>&1 | grep rewind-debug
#
# Or run the helper that does it for you:
#   ./scripts/test-rewind-isolated.sh --log
set -e

DIR="/tmp/rewind-isolated"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_SRC="$REPO_ROOT/.pi/extensions/rewind"

# Create the test directory if it doesn't exist
mkdir -p "$DIR/.pi/extensions"
cd "$DIR"

# Initialize git if not already
if [ ! -d ".git" ]; then
  git init --quiet
  git config user.email "test@test.local"
  git config user.name "test"
  echo "# rewind test" > README.md
  git add . && git commit -m "initial" --quiet
fi

# Install the rewind extension
rm -rf "$DIR/.pi/extensions/rewind"
cp -r "$EXT_SRC" "$DIR/.pi/extensions/rewind"

# Set up a minimal settings.json that disables everything except rewind
cat > "$DIR/.pi/settings.json" << 'EOF'
{
  "extensions": [],
  "packages": []
}
EOF

echo "=== Setup complete ==="
echo "Test dir: $DIR"
echo "Extension: rewind (only)"
echo "All other extensions: disabled"
echo
echo "To launch: cd $DIR && pi"
echo "To capture logs: cd $DIR && pi 2>&1 | grep rewind-debug"
echo

if [ "$1" = "--log" ]; then
  echo "=== Running pi with log capture (Ctrl+C to exit) ==="
  cd "$DIR"
  pi 2>&1 | grep --color=always "rewind-debug\|^[a-zA-Z].*Error"
fi
