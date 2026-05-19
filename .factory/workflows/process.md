---
title: Agent Process
version: "1.0"
authority: CANONICAL — overrides all other files
---

# Agent Process

> Single source of truth for HOW to work in the Factory repo.

---

## 1. Four Rules — No Exceptions

| Rule | Command |
|------|---------|
| **Heartbeat** — before every task and after every commit | `FACTORY_PROJECT_ROOT=$(pwd) /path/to/pulse.sh "<task>"` |
| **Token budget** — keep every prompt under 64k tokens | Stay under 50k working input; split large tasks |
| **Validate before commit** — zero broken code committed | `npx tsc --noEmit && npx eslint .` |
| **Context reflects reality** — update after structural changes | Update `context.toon` + write ADR if architectural |

> Scripts path: `/Users/pretheesh/Projects/ag-starter/.agents/skills/`

---

## 2. Session Lifecycle

```
START → bootstrap.md → [WORK LOOP] → SESSION END (§6) → END
```

**Work loop:**
1. Write code / produce output
2. Self-review diff (no debug logs, no hardcoded paths, no placeholders)
3. `npx tsc --noEmit` → must pass → see `commit.md`
4. `git commit -m "type(scope): what and why"`
5. Heartbeat pulse "Committed: <msg>"
6. If structural change → update context (§5)

---

## 3. Decision Tree

| Situation | Action |
|-----------|--------|
| Starting a session | → `bootstrap.md` (always) |
| About to `git commit` | → `commit.md` (must pass first) |
| Made a structural change | → §5 — update context immediately |
| Ending a session | → §6 — session end checklist |
| Something went wrong | → §4 Error Recovery |
| Adding a new engine module | → create `engine/<module>.ts`, export from `cli.ts`, add API route |
| Adding a new UI feature | → create component, add API route, wire into `dashboard.tsx` |

---

## 4. Error Recovery

| Symptom | Fix |
|---------|-----|
| `tsc --noEmit` fails 3+ times | STOP → escalate |
| Context size > 50k tokens | compress worklog → trim → retry |
| `context.toon` parse error | `git checkout .factory/context/context.toon` |
| Task not in `todo.toon` | `manage.sh list` → find or add it |
| Heartbeat stale (> 30 min) | `pulse.sh "resuming"` → continue |

**Stuck checklist:**
```
[ ] Heartbeat fresh (< 30 min)?    NO → pulse.sh "resuming"
[ ] Task claimed in todo.toon?     NO → manage.sh start <id>
[ ] Context < 50k tokens?          NO → compress worklog
[ ] ADR covers this decision?      NO → write ADR first
[ ] Requirements clear?            NO → STOP, ask the user
```

**Escalation format:**
```
BLOCKED: <one-line summary>
Context: <what you were doing>
Error:   <exact error>
Attempts:<what you tried>
Suggest: <your proposed next step>
```

---

## 5. Context Updates (after structural changes)

A **structural change** = new engine module, new dependency, new/modified CLI command, architectural decision.

Bug fixes and styling → **not structural**, skip this.

**Steps:**
1. Update `context.toon` — only relevant sections (stack, key_decisions, architecture, project.last_updated)
2. Update `todo.toon` via manage.sh — complete or add tasks
3. Append to worklog:
   ```bash
   FACTORY_PROJECT_ROOT=$(pwd) \
     /Users/pretheesh/Projects/ag-starter/.agents/skills/auto-context/update-context.sh "<what changed>"
   ```
4. Commit context:
   ```bash
   git add .factory/ && git commit -m "chore(context): <what changed>"
   ```

---

## 6. Session End Checklist

```bash
# 1. Heartbeat
FACTORY_PROJECT_ROOT=$(pwd) pulse.sh "Session end: <task_id>"

# 2. Complete task
TASKS_FILE=.factory/task-manager/todo.toon \
  manage.sh complete --id <id> --summary "<what was done>"

# 3. Update worklog
FACTORY_PROJECT_ROOT=$(pwd) update-context.sh "<session summary>"

# 4. Commit context
git add .factory/ && git commit -m "chore(context): session end — <task_id>"
```

---

## 7. ADR Rules

Write an ADR **before implementing** when you:
- Add a new dependency to `package.json`
- Change folder structure significantly  
- Switch an architectural pattern (e.g. replacing the pipeline)
- Make a decision affecting multiple files that is hard to reverse

Valid ADR: Context · Decision · Consequences · Status (all four required)

---

## 8. File Roles

| File | Purpose |
|------|---------|
| `agents.md` | Entry point — role, stack, quick commands |
| `.factory/workflows/process.md` | All rules (this file) |
| `.factory/workflows/bootstrap.md` | Session start checklist |
| `.factory/workflows/commit.md` | Pre-commit validation gate |
| `.factory/context/context.toon` | Live project state — single source of truth |
| `.factory/context/heartbeat.toon` | Liveness timestamp (overwrite, never append) |
| `.factory/task-manager/todo.toon` | Task queue — only via manage.sh |
| `.factory/skill-index.toon` | Available skills with script paths |
| `.factory/knowledge/builds/` | Build history from Factory engine |

---

## 9. Quick Commands

```bash
# Heartbeat
FACTORY_PROJECT_ROOT=$(pwd) \
  /Users/pretheesh/Projects/ag-starter/.agents/skills/heartbeat/pulse.sh "<msg>"

# Task management
TASKS_FILE=.factory/task-manager/todo.toon \
  /Users/pretheesh/Projects/fikr-workspace/cowork/.agents/skills/task-manager/manage.sh list
  
TASKS_FILE=$(pwd)/.factory/task-manager/todo.toon \
  /Users/pretheesh/Projects/fikr-workspace/cowork/.agents/skills/task-manager/manage.sh start <id>

TASKS_FILE=.factory/task-manager/todo.toon \
  /Users/pretheesh/Projects/ag-starter/.agents/skills/task-manager/manage.sh complete --id <id> --summary "<what>"

# Worklog
FACTORY_PROJECT_ROOT=$(pwd) \
  /Users/pretheesh/Projects/ag-starter/.agents/skills/auto-context/update-context.sh "<msg>"

# Git
git log --oneline -20
```

> **Note:** Once us_004_cli_facade is complete, all commands above become `factory pulse`, `factory task`, `factory context update`.
