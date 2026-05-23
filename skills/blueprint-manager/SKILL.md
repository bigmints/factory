---
name: factory-bridge-manager
description: >
  Manages the .factory bridge in a connected project — initialising the
  directory structure, keeping logs/ up to date, writing knowledge entries,
  and maintaining the worklog. Use when setting up a new bridge, writing an
  ADR to knowledge/, or troubleshooting the agent state files.
---

# Factory Bridge Manager Skill

The `.factory/` directory is the bridge between a project repo and the Factory build engine.
This skill covers: initialising it, maintaining `logs/`, writing to `knowledge/`, and keeping the worklog.

---

## .factory Directory Structure

```
.factory/
├── scaffold.yaml          ← Planning spec: features → stories (board reads this)
├── factory.yaml           ← Bridge config: stack, conventions, paths
├── stories/
│   └── features/          ← Individual story YAML files
├── knowledge/             ← Agent-authored ADRs, decisions, conventions
├── logs/                  ← Machine-written runtime files (never hand-edit)
│   ├── state.yaml         ← Project state snapshot
│   ├── heartbeat.yaml     ← Liveness signal
│   ├── worklog.yaml       ← Append-only session log
│   ├── builds/            ← Build receipts (one JSON per build)
│   └── failures/          ← Failure records
├── task-manager/
│   ├── todo.yaml          ← Task queue
│   └── manage.sh          ← Task lifecycle CLI
└── workflows/             ← Workflow markdown scripts
```

---

## Initialising the bridge

Run from within the connected project repo:

```bash
factory init-bridge <repo-path>
```

This creates the full `.factory/` structure above, writes a starter `scaffold.yaml`, and registers the project.

Or manually: create the dirs and write `factory.yaml` + `scaffold.yaml` following the skill schemas.

---

## factory.yaml schema

```yaml
version: 1

project:
  name: my-app
  description: >
    One paragraph description.

stack:
  framework: next.js         # next.js | node | vite | remix | astro
  language: typescript
  packageManager: npm        # npm | pnpm | yarn | bun
  styling: tailwind          # tailwind | vanilla-css | shadcn/ui
  database: supabase         # supabase | postgres | sqlite | none
  cloud: vercel              # vercel | gcp | aws | none

conventions:
  - "TypeScript strict mode; no any"
  - "Components in src/components/<Name>.tsx"
  # Add project-specific conventions here

knowledge:
  - path: AGENTS.md
  - path: .factory/knowledge/   # directory — all files in it are injected

agentic:
  logs_dir: .factory/logs
  stories_dir: .factory/stories/features
  task_queue: .factory/task-manager/todo.yaml
  skill_index: .factory/skill-index.yaml
  workflows_dir: .factory/workflows
  knowledge_dir: .factory/knowledge
```

---

## Writing a knowledge entry

Use knowledge entries to record decisions that future build runs must be aware of.
Save as `.factory/knowledge/<slug>.md`:

```markdown
# ADR: Chose Zustand over Redux

Date: 2025-05-23
Decision: Use Zustand for client state management.

## Rationale
- Much smaller bundle (8kb vs 50kb+)
- No boilerplate; slice pattern matches our conventions
- Works natively with React hooks

## Implications
- All stores in src/store/<slice>.ts
- Never import Redux or RTK
```

The engine auto-discovers all files in `.factory/knowledge/` and injects them into every LLM prompt.

---

## Maintaining the worklog

The worklog at `.factory/logs/worklog.yaml` is append-only. The engine writes to it automatically on every build step. You can also write to it manually:

```bash
factory pulse "starting auth feature build"
```

Or via the CLI:
```bash
npx tsx engine/cli.ts blueprint update "completed WebSocket bridge setup"
```

---

## Checking agent liveness

```bash
# Check when the agent last wrote a heartbeat
cat .factory/logs/heartbeat.yaml

# Check the project state snapshot
cat .factory/logs/state.yaml
```

---

## Git hooks

Install a post-commit hook that auto-updates the worklog on every commit:

```bash
factory hooks install
```

This writes `.git/hooks/post-commit` which calls `factory pulse` on every commit.
