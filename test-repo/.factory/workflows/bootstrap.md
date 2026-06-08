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
  echo "Git hooks not installed — run setup if needed"
```

**1 — Verify repository root**
```bash
git rev-parse --show-toplevel
```

**2 — Load context (always)**

| # | File | Extract |
|---|------|---------| 
| 1 | `agents.md` | Your role and quick commands |
| 2 | `.factory/workflows/process.md` | All rules |
| 3 | `.factory/logs/state.yaml` | Project state, stack, key decisions |

**3 — Load context (on demand)**

| File | When to load |
|------|-------------|
| `.factory/task-manager/todo.yaml` | Picking a task, checking priorities |
| `.factory/knowledge/builds/` | Understanding what's already built |
| `git log --oneline -20` | Recent changes |

```bash
# Quick check — in_progress task to resume?
.factory/task-manager/manage.sh list --status in_progress
```

**4 — Check heartbeat**
```bash
cat .factory/logs/heartbeat.yaml
```
| Age | Action |
|-----|--------|
| < 5 min | Continue |
| 5–30 min | Note it, continue |
| > 30 min | Run pulse first |

```bash
factory pulse "Session start"
```

**5 — Claim a task**
```bash
factory task list

factory task start <task_id>
```
Rules: lowest priority first · never claim `in_progress` · never re-claim `completed`

**6 — Start heartbeat**
```bash
factory pulse "<task_id>: starting"
```

---

Bootstrap complete → follow `.factory/workflows/process.md`

---

## Recovery

| Problem | Fix |
|---------|-----|
| `state.yaml` parse error | `git checkout .factory/logs/state.yaml` |
| `todo.yaml` corrupted | `git checkout .factory/task-manager/todo.yaml` |
| No tasks | `factory task add "summary" --priority 2` |
| Skills not found | Check `.factory/skill-index.yaml` · verify paths exist |
