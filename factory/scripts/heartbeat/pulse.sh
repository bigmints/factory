#!/usr/bin/env bash
# heartbeat/pulse.sh
# Usage: pulse.sh "<current task description>"
# Writes a liveness timestamp to .factory/context/heartbeat.toon so
# humans and monitoring scripts can detect a stalled agent.

set -euo pipefail

TASK="${1:-unknown task}"
PROJECT_ROOT="${FACTORY_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo ".")}"
HEARTBEAT_FILE="$PROJECT_ROOT/.factory/context/heartbeat.toon"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HOSTNAME=$(hostname -s 2>/dev/null || echo "unknown-host")

# Ensure directory exists
mkdir -p "$(dirname "$HEARTBEAT_FILE")"

# Write (overwrite) the heartbeat file
cat > "$HEARTBEAT_FILE" <<EOF
heartbeat:
  last_seen: "$TIMESTAMP"
  host: "$HOSTNAME"
  task: "$TASK"
  status: alive
EOF

echo "[heartbeat] pulse written at $TIMESTAMP — task: $TASK"
