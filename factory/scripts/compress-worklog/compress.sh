#!/bin/bash
# compress-worklog/compress.sh
# Compresses the worklog to keep context token count low.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Running worklog compression..."
node "$SCRIPT_DIR/compress.mjs"

# Commit the compressed worklog so compression is tracked in git history
if git diff --quiet .factory/context/worklog.toon; then
  echo "Nothing to commit — worklog was already small enough."
else
  git add .factory/context/worklog.toon
  git commit -m "chore(context): compress worklog [auto]"
  echo "Compressed worklog committed."
fi
