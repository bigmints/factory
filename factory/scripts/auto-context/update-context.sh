#!/bin/bash
# auto-context/update-context.sh
# Usage: ./factory/scripts/auto-context/update-context.sh "<Work description>"
# Appends a new manual entry to the worklog in TOON format.

if [[ "$1" == "--help" || -z "$1" ]]; then
  echo "Usage: ./factory/scripts/auto-context/update-context.sh \"<Work description>\""
  echo "Appends a new manual entry to the worklog in TOON format."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/update-context.mjs" "$@"
