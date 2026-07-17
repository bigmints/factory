#!/bin/bash
PORT=11498

# Kill any process using the port
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  echo "⚡ Killing existing process on port $PORT (PID: $PID)"
  kill -9 $PID 2>/dev/null
  sleep 1
fi

FACTORY_DIR="${FACTORY_DIR:-$HOME/.factory}"
SERVER="$FACTORY_DIR/ui/server.js"

if [ ! -f "$SERVER" ]; then
  echo "❌ Production UI not installed at $SERVER"
  echo "Run: make install"
  exit 1
fi

echo "🚀 Starting Factory production server on http://localhost:$PORT"
cd "$FACTORY_DIR/ui"
PORT="$PORT" HOSTNAME="0.0.0.0" node server.js 2>&1
