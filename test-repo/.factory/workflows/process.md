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
| **Heartbeat** — before every task and after every commit | `factory pulse "<task>"` |
| **Token budget** — keep every prompt under 64k tokens | Stay under 50k working input; split large tasks |
| **Validate before commit** — zero broken code committed | `npx tsc --noEmit && npx eslint .` |
| **Context reflects reality** — update after structural changes | Update context + write ADR if architectural |

> Commands: `factory` CLI

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
| Context parse error | `git checkout .factory/logs/state.yaml` |
| Task not in `todo.yaml` | `manage.sh list` → find or add it |
| Heartbeat stale (> 30 min) | `factory pulse "resuming"` → continue |

**Stuck checklist:**
```
[ ] Heartbeat fresh (< 30 min)?    NO → factory pulse "resuming"
[ ] Task claimed in todo.yaml?     NO → factory task start <id>
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
1. Update `.factory/logs/state.yaml` — only relevant sections (stack, key_decisions, architecture, project.last_updated)
2. Update `todo.yaml` via manage.sh — complete or add tasks
3. Append to worklog:
   ```bash
   factory blueprint update "<what changed>"
   ```
4. Commit context:
   ```bash
   git add .factory/ && git commit -m "chore(context): <what changed>"
   ```

---

## 6. Session End Checklist

```bash
# 1. Heartbeat
factory pulse "Session end: <task_id>"

# 2. Complete task
factory task complete --id <id> --summary "<what was done>"

# 3. Update worklog
factory blueprint update "<session summary>"

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
| `.factory/logs/state.yaml` | Live project state — single source of truth |
| `.factory/logs/heartbeat.yaml` | Liveness timestamp (overwrite, never append) |
| `.factory/task-manager/todo.yaml` | Task queue — only via manage.sh |
| `.factory/skill-index.yaml` | Available skills with script paths |
| `.factory/knowledge/builds/` | Build history from Factory engine |

---

## 9. Quick Commands

```bash
# Heartbeat
factory pulse "<msg>"

# Task management
factory task list

factory task start <id>

factory task complete --id <id> --summary "<what>"

# Worklog
factory blueprint update "<msg>"

# Git
git log --oneline -20
```

> **Note:** Once us_004_cli_facade is complete, all commands above become `factory pulse`, `factory task`, `factory context update`.
