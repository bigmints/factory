---
title: Bootstrap
trigger: Every new agent session — mandatory
---

# Bootstrap

> Run at the start of every session. Read-only — changes nothing.

## Steps

**0 — Verify git hooks installed** *(one-time check)*
```bash
ls .git/hooks/pre-commit .git/hooks/post-commit 2>/dev/null || \
  bash /Users/pretheesh/Projects/ag-starter/.agents/skills/heartbeat/setup-hooks.sh
```

**1 — Verify repository root**
```bash
git rev-parse --show-toplevel  # must be .../factory
```

**2 — Load context (always)**

| # | File | Extract |
|---|------|---------| 
| 1 | `agents.md` | Your role and quick commands |
| 2 | `.factory/workflows/process.md` | All rules |
| 3 | `.factory/context/context.toon` | Project state, stack, key decisions |

**3 — Load context (on demand)**

| File | When to load |
|------|-------------|
| `.factory/task-manager/todo.toon` | Picking a task, checking priorities |
| `.factory/knowledge/builds/` | Understanding what's already built |
| `git log --oneline -20` | Recent changes |

```bash
# Quick check — in_progress task to resume?
TASKS_FILE=$(pwd)/.factory/task-manager/todo.toon \
  /Users/pretheesh/Projects/fikr-workspace/cowork/.agents/skills/task-manager/manage.sh list --status in_progress
```

**4 — Check heartbeat**
```bash
cat .factory/context/heartbeat.toon
```
| Age | Action |
|-----|--------|
| < 5 min | Continue |
| 5–30 min | Note it, continue |
| > 30 min | Run pulse first |

```bash
FACTORY_PROJECT_ROOT=$(pwd) \
  /Users/pretheesh/Projects/ag-starter/.agents/skills/heartbeat/pulse.sh "Session start"
```

**5 — Claim a task**
```bash
TASKS_FILE=$(pwd)/.factory/task-manager/todo.toon \
  /Users/pretheesh/Projects/fikr-workspace/cowork/.agents/skills/task-manager/manage.sh list

TASKS_FILE=$(pwd)/.factory/task-manager/todo.toon \
  /Users/pretheesh/Projects/fikr-workspace/cowork/.agents/skills/task-manager/manage.sh start <task_id>
```
Rules: lowest priority first · never claim `in_progress` · never re-claim `completed`

**6 — Start heartbeat**
```bash
FACTORY_PROJECT_ROOT=$(pwd) \
  /Users/pretheesh/Projects/ag-starter/.agents/skills/heartbeat/pulse.sh "<task_id>: starting"
```

---

Bootstrap complete → follow `.factory/workflows/process.md`

---

## Recovery

| Problem | Fix |
|---------|-----|
| `context.toon` parse error | `git checkout .factory/context/context.toon` |
| `todo.toon` corrupted | `git checkout .factory/task-manager/todo.toon` |
| No tasks | `manage.sh add "summary" --priority 2` |
| Skills not found | Check `.factory/skill-index.toon` · verify paths exist |
