# Heartbeat Skill

Tracks agent liveness by writing a timestamp file on each task start and commit. Humans (or CI) can then detect a stalled agent quickly without needing to watch logs.

## How It Works

- **`pulse.sh`** — the agent calls this. It overwrites `.agents/context/heartbeat.toon` with the current UTC timestamp and the active task description.
- **`check.sh`** — you (the human) call this from a separate terminal to see if the agent is still alive.

The heartbeat file is intentionally **always overwritten** (not appended) so it always reflects the agent's most recent known state.

## Agent Usage

Call `pulse.sh` at two specific moments:

```bash
# 1. At the very start of every task (before any file reads or code changes)
./.agents/skills/heartbeat/pulse.sh "Implementing auth middleware"

# 2. After every commit
./.agents/skills/heartbeat/pulse.sh "Committed: feat: add JWT refresh token logic"
```

## Human Usage — Checking Agent Liveness

Open a second terminal and run:

```bash
# Default: stale if no pulse in the last 10 minutes
./.agents/skills/heartbeat/check.sh

# Custom threshold
./.agents/skills/heartbeat/check.sh --timeout-minutes 5
```

Sample output (alive):
```
[heartbeat] Last pulse : 2026-05-06T17:32:10Z (3 min ago)
[heartbeat] Last task  : Implementing auth middleware
[heartbeat] ✅  Agent is alive (pulsed within the last 10 min)
```

Sample output (stalled):
```
[heartbeat] Last pulse : 2026-05-06T16:55:02Z (42 min ago)
[heartbeat] Last task  : Refactoring database layer
[heartbeat] ❌  Agent appears STALLED — no pulse for 42 minutes (threshold: 10 min)

  What to do:
  1. Check if the agent process is still running.
  2. Review the last task in the heartbeat file — it may be blocked on a tool call or waiting for input.
  3. If stuck, interrupt the agent, read worklog.toon for the last known state, and restart.
```

## Poll Loop (Optional Automation)

To watch for staleness continuously in the background:

```bash
while true; do
  ./.agents/skills/heartbeat/check.sh --timeout-minutes 10
  sleep 120   # check every 2 minutes
done
```

Or as a one-liner that beeps when stalled:

```bash
watch -n 120 './.agents/skills/heartbeat/check.sh || echo "🔔 AGENT STALLED"'
```

## The Heartbeat File

Location: `.agents/context/heartbeat.toon`

Format:
```yaml
heartbeat:
  last_seen: "2026-05-06T17:32:10Z"
  host: "macbook-pro"
  task: "Implementing auth middleware"
  status: alive
```

This file is committed to git during the `auto-context` step so the liveness state is visible in the repository history.
