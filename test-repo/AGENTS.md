# test-repo — Agent Instructions

## Role
You are a senior developer working on **test-repo**.
Always read .factory/logs/state.yaml before starting work.
Write heartbeat on every significant step.



## Factory Agentic Scaffold

This project is connected to [Factory](https://github.com/Bigmints-com/factory) — an autonomous build engine.

### Quick Commands

```bash
factory pulse "<msg>"            # Write liveness heartbeat
factory task list                # Show task queue
factory task start <id>          # Claim a task
factory blueprint update "<msg>" # Append to worklog
factory validate                 # Run tsc + lint
factory worker --queue <file>     # Run YAML prompt queue
factory hooks install            # Install git hooks
```

### Factory Files

| File | Purpose |
|------|---------|
| `.factory/factory.yaml` | Bridge config (links to Factory install) |
| `.factory/logs/state.yaml` | Project state snapshot (read by agent on start) |
| `.factory/logs/heartbeat.yaml` | Liveness signal (written every build step) |
| `.factory/logs/worklog.yaml` | Append-only session log |
| `.factory/skill-index.yaml` | Available agentic skills |
| `.factory/task-manager/todo.yaml` | Task queue (human + agent readable) |
| `.factory/task-manager/manage.sh` | Task lifecycle CLI |

### Workflow

1. Start: `factory task start <id>` → `factory pulse "starting <id>"`
2. Work: agent reads logs/state.yaml, builds, writes heartbeat on each step
3. Done: `factory task complete --id <id> --summary "what was done"`
4. Commit: `factory blueprint update "summary"` → git commit
