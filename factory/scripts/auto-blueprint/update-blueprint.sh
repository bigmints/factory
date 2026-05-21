#!/bin/bash
# auto-blueprint/update-blueprint.sh
# Usage: ./factory/scripts/auto-blueprint/update-blueprint.sh "<Work description>"
# Appends a new manual entry to the worklog in TOON format.

if [[ "$1" == "--help" || -z "$1" ]]; then
  echo "Usage: ./factory/scripts/auto-blueprint/update-blueprint.sh \"<Work description>\""
  echo "Appends a new manual entry to the worklog in TOON format."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/update-blueprint.mjs" "$@"
