#!/usr/bin/env bash
# heartbeat/check.sh
# Usage: check.sh [--timeout-minutes N]
# Reads .factory/logs/heartbeat.yaml and reports whether the agent is alive.
# Exits 0 if alive, 1 if stalled or heartbeat is missing.
# Default stale threshold: 10 minutes.

set -euo pipefail

TIMEOUT_MINUTES=10

# Parse --timeout-minutes flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout-minutes)
      TIMEOUT_MINUTES="$2"; shift 2;;
    *)
      shift;;
  esac
done

PROJECT_ROOT="${FACTORY_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo ".")}"
HEARTBEAT_FILE="$PROJECT_ROOT/.factory/logs/heartbeat.yaml"
# Fallback to legacy paths
if [[ ! -f "$HEARTBEAT_FILE" && -f "$PROJECT_ROOT/.factory/context/heartbeat.yaml" ]]; then
  HEARTBEAT_FILE="$PROJECT_ROOT/.factory/context/heartbeat.yaml"
elif [[ ! -f "$HEARTBEAT_FILE" && -f "$PROJECT_ROOT/.factory/context/heartbeat.toon" ]]; then
  HEARTBEAT_FILE="$PROJECT_ROOT/.factory/context/heartbeat.toon"
fi

if [[ ! -f "$HEARTBEAT_FILE" ]]; then
  echo "[heartbeat] ⚠️  No heartbeat file found. Agent has never pulsed or the file was deleted."
  echo "            Expected: $HEARTBEAT_FILE"
  exit 1
fi

# Extract last_seen value
LAST_SEEN=$(grep 'last_seen:' "$HEARTBEAT_FILE" | sed -E 's/[[:space:]]*last_seen:[[:space:]]*"?([^"]*)"?/\1/')
TASK=$(grep 'task:' "$HEARTBEAT_FILE" | sed -E 's/[[:space:]]*task:[[:space:]]*"?([^"]*)"?/\1/')

if [[ -z "$LAST_SEEN" ]]; then
  echo "[heartbeat] ⚠️  Heartbeat file exists but last_seen is empty or malformed."
  cat "$HEARTBEAT_FILE"
  exit 1
fi

# Convert to epoch — always use UTC
# Strip trailing Z for parsing, force UTC via TZ env
LAST_SEEN_STRIPPED="${LAST_SEEN%Z}"
if date -j -u -f "%Y-%m-%dT%H:%M:%S" "$LAST_SEEN_STRIPPED" +%s &>/dev/null 2>&1; then
  # macOS
  LAST_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$LAST_SEEN_STRIPPED" +%s)
else
  # Linux / GNU date
  LAST_EPOCH=$(date -u -d "$LAST_SEEN" +%s)
fi

NOW_EPOCH=$(date -u +%s)
ELAPSED_SECONDS=$(( NOW_EPOCH - LAST_EPOCH ))
ELAPSED_MINUTES=$(( ELAPSED_SECONDS / 60 ))
TIMEOUT_SECONDS=$(( TIMEOUT_MINUTES * 60 ))

echo "[heartbeat] Last pulse : $LAST_SEEN ($ELAPSED_MINUTES min ago)"
echo "[heartbeat] Last task  : $TASK"

if [[ $ELAPSED_SECONDS -le $TIMEOUT_SECONDS ]]; then
  echo "[heartbeat] ✅  Agent is alive (pulsed within the last ${TIMEOUT_MINUTES} min)"
  exit 0
else
  echo "[heartbeat] ❌  Agent appears STALLED — no pulse for ${ELAPSED_MINUTES} minutes (threshold: ${TIMEOUT_MINUTES} min)"
  echo ""
  echo "  What to do:"
  echo "  1. Check if the agent process is still running."
  echo "  2. Review the last task in the heartbeat file — it may be blocked on a tool call or waiting for input."
  echo "  3. If stuck, interrupt the agent, read worklog.yaml for the last known state, and restart."
  exit 1
fi
