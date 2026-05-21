#!/bin/bash
# compress-worklog/compress.sh
# Compresses the worklog to keep context token count low.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Running worklog compression..."
node "$SCRIPT_DIR/compress.mjs"

# Determine the active worklog path being compressed
PROJECT_ROOT="${FACTORY_PROJECT_ROOT:-$(pwd)}"
WORKLOG_PATH=""

if [ -f "$PROJECT_ROOT/.factory/blueprint/worklog.yaml" ]; then
  WORKLOG_PATH=".factory/blueprint/worklog.yaml"
elif [ -f "$PROJECT_ROOT/.factory/blueprint/worklog.toon" ]; then
  WORKLOG_PATH=".factory/blueprint/worklog.toon"
elif [ -f "$PROJECT_ROOT/.factory/context/worklog.yaml" ]; then
  WORKLOG_PATH=".factory/context/worklog.yaml"
elif [ -f "$PROJECT_ROOT/.factory/context/worklog.toon" ]; then
  WORKLOG_PATH=".factory/context/worklog.toon"
fi

if [ -n "$WORKLOG_PATH" ]; then
  # Commit the compressed worklog so compression is tracked in git history
  # Check if the file is tracked or modified in Git
  if git ls-files --error-unmatch "$PROJECT_ROOT/$WORKLOG_PATH" >/dev/null 2>&1; then
    if git diff --quiet "$PROJECT_ROOT/$WORKLOG_PATH"; then
      echo "Nothing to commit — worklog was already small enough."
    else
      git add "$PROJECT_ROOT/$WORKLOG_PATH"
      git commit -m "chore(blueprint): compress worklog [auto]"
      echo "Compressed worklog committed."
    fi
  else
    echo "Worklog file is not tracked in git yet. Compression done locally."
  fi
else
  echo "No worklog found to commit."
fi
