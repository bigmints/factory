# Factory — Agent Instructions

## Role

You are a senior TypeScript/Node.js engineer working on the Factory build engine. Your job is to implement the agentic engine upgrade — replacing the hardcoded plan→build→test→iterate pipeline with a tool-calling LLM loop, integrating TOON context, and wiring the CLI facade.

## Stack

| Layer | Technology |
|-------|----------|
| Runtime | Node.js (npx tsx) — no transpilation step |
| Frontend | Next.js 15 + App Router |
| Styling | Tailwind CSS + Shadcn/UI |
| State | SQLite (better-sqlite3) + JSON files |
| Language | TypeScript 5, strict mode |
| Package Manager | npm |
| Context Format | TOON (@toon-format/toon) |
| CLI Delegation | Worker (YAML prompt queue → pi/gemini/claude/agy CLI) |
| LLM Engine | Tool-calling loop (replacing plan→build→test→iterate) |

## Quick Commands

```bash
# Engine
npx tsx engine/cli.ts build <spec.yaml>
npx tsx engine/cli.ts validate <spec.yaml>
npx tsx engine/cli.ts status
npx tsx engine/cli.ts queue list
npx tsx engine/cli.ts queue start

# CLI facade (after us_004)
factory pulse "<msg>"
factory task list
factory context update "<msg>"
factory validate
factory worker --queue <file>
factory worker default-cli <cli-name>
factory hooks install

# Agentic scripts
FACTORY_PROJECT_ROOT=$(pwd) factory/scripts/heartbeat/pulse.sh "<msg>"
FACTORY_PROJECT_ROOT=$(pwd) factory/scripts/heartbeat/check.sh
FACTORY_PROJECT_ROOT=$(pwd) factory/scripts/auto-context/update-context.sh "<msg>"
.factory/task-manager/manage.sh list
.factory/task-manager/manage.sh start <id>
.factory/task-manager/manage.sh complete --id <id> --summary "<what>"

# Validation (must pass before commit)
npx tsc --noEmit
npm run lint

# Git
git add -A && git commit -m "feat(scope): what and why"
git log --oneline -20
```

## Project Structure

```
factory/
├── engine/                ← Core build engine (TypeScript, runs via npx tsx)
│   ├── cli.ts             ← CLI entry point & command dispatcher
│   ├── config.ts          ← projects.json, settings.json, factory.yaml loading
│   ├── spec.ts            ← Load, validate, update status of YAML specs
│   ├── context.ts         ← Gather knowledge, conventions & app integration context
│   ├── generate.ts        ← LLM pipeline: plan → build → test → iterate (targeted)
│   ├── task-classifier.ts ← Classifies tasks, determines validation gates
│   ├── writer.ts          ← File writer, npm install, git ops, knowledge feedback
│   ├── db.ts              ← SQLite database (queue, builds history)
│   ├── queue.ts           ← Queue manager for autonomous batch builds
│   ├── types.ts           ← All shared TypeScript types
│   └── log.ts             ← Structured coloured logging
├── ui/                    ← Next.js dashboard (port 4040)
│   └── src/
│       ├── app/
│       │   └── api/       ← API routes (specs, build, validate, queue, chat)
│       └── components/    ← Dashboard, sidebar, spec editor, queue view, etc.
├── HOW_IT_WORKS.md        ← Human-readable end-to-end workflow doc
├── start.sh               ← Start script (engine + UI)
├── package.json           ← Root dependencies
└── tsconfig.json          ← TypeScript config
```

## Engine Modules

| Module               | Responsibility                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `cli.ts`             | Parses CLI args, dispatches to handlers (build, validate, queue, project, sync)            |
| `config.ts`          | Reads/writes `projects.json`, `settings.json`, `.factory/factory.yaml`                     |
| `spec.ts`            | Loads YAML specs, validates schemas, updates spec `status` field in-place                  |
| `context.ts`         | Gathers knowledge files, conventions, app integration context from the target repo         |
| `generate.ts`        | Orchestrates LLM calls: plan → build → test → iterate. Targeted fixes, modular generation  |
| `task-classifier.ts` | Classifies tasks into profiles (config/scaffold/frontend/full-app), gates validation steps |
| `writer.ts`          | Writes files, runs `npm install`, git commit/push, knowledge entries, AGENTS.md            |
| `db.ts`              | SQLite via `better-sqlite3`: queue_items, builds, queue_state tables                       |
| `queue.ts`           | Dependency-aware queue: enqueue, dequeue (phase + dependsOn gating), stats                 |
| `types.ts`           | AppSpec, FeatureSpec, TaskProfile, AppIntegrationContext, BuildResult                      |
| `log.ts`             | Coloured step/error/success logging                                                        |

## Build Pipeline

```
Queue → Gather → Validate → Plan → Build → Test → Iterate → Write → Install → AGENTS.md → Knowledge → Commit → Push
```

### Test Step (Real Toolchain)

The engine writes generated code to a temp directory and runs actual commands based on `spec.stack`:

- `npm install` (or pnpm/yarn/bun)
- `tsc --noEmit` (if TypeScript)
- Linter: eslint, biome, oxlint, prettier
- Test runner: vitest, jest, playwright, cypress
- **Runtime smoke test**: spawns `npm run dev`, waits for port, checks HTTP 200

The `task-classifier.ts` determines which validation gates apply per task type:

| Task Type  | Install | tsc | Lint | Tests | Runtime | Max Iterations |
| ---------- | ------- | --- | ---- | ----- | ------- | -------------- |
| `config`   | ✗       | ✗   | ✗    | ✗     | ✗       | 0              |
| `scaffold` | ✓       | ✗   | ✗    | ✗     | ✗       | 2              |
| `frontend` | ✓       | ✓   | ✓    | ✓     | ✓       | 4              |
| `full-app` | ✓       | ✓   | ✓    | ✓     | ✓       | 5              |

### Targeted Iteration

When errors are found, the engine uses **targeted iteration** instead of regenerating all files:

1. Parses tsc/lint error output to extract broken filenames
2. Identifies related files (importers of broken files)
3. Sends ONLY broken + related files to LLM for fixing
4. Merges fixes back into the full file set — untouched files are preserved

### Module-by-Module Generation

For apps >15 planned files, `executeBuild` decomposes the plan into ordered modules (`config → utils → db → api → components → pages`) and generates each in a separate LLM call. Each module's prompt includes exports from previously generated modules.

### Integration-Aware Feature Builds

Feature builds call `gatherAppContext()` on the target app to read its package.json, tsconfig.json, file tree, and derive its stack. This context is injected into both the generation and iteration prompts so the LLM generates complementary code.

### Post-Build

After writing files, the engine:

1. Runs `npm install` in the target app directory
2. Generates `AGENTS.md` inside the app with stack, structure, and conventions
3. Writes a knowledge entry to `.factory/logs/builds/` for future context
4. Commits and pushes

## Spec Status Lifecycle

```
draft → in-progress → validation → done | review
```

Updated in the YAML file itself via `updateSpecStatus()`.

## Key Concepts

### Specs

YAML files in `.factory/specs/apps/` (app specs) and `.factory/specs/features/` (feature specs). Define the app's stack, data model, pages, auth, and deployment.

**Feature specs** support two additional fields for build ordering:

- `phase: 1` — Build phase (1 = foundation, 2 = core, 3 = polish). Lower phases build first.
- `dependsOn: [auth-system, data-models]` — Slugs of other specs that must complete before this spec can build. The engine enforces this — a spec will NOT dequeue until all its dependencies are `completed`.

### Bridge

The `.factory/` folder inside a connected project repo. Contains `factory.yaml` (manifest), `knowledge/` (build history), and `specs/` subdirectories.

### Queue

SQLite-backed (`factory.db`) build queue with **dependency-aware scheduling**. Items: `pending → running → completed | failed`. The queue dequeues items in phase order (ascending) and only processes a spec when all its `dependsOn` specs are `completed`. Supports priority, retry, batch processing, and autonomous `queue start`.

When `queue start` finishes, it reports any specs still blocked by unmet dependencies.

### Knowledge Feedback

Each build writes a summary to `.factory/logs/builds/`. The context gatherer auto-discovers these, so subsequent specs have full awareness of what's already been built.

## CLI Commands

```
factory build <spec.yaml>              Full pipeline
factory validate <spec.yaml>           Validate a spec
factory status                         Show spec statuses
factory sync <repo-path>               Sync .factory from repo
factory init-bridge <repo-path>        Init .factory bridge in repo

factory project add <repo-path>        Connect a repo
factory project list                   List connected repos
factory project switch <id>            Switch active project
factory project remove <id>            Disconnect a repo

factory feature build <spec.yaml>      Build a feature
factory feature validate <spec.yaml>   Validate a feature spec

factory queue list                     List all queue items
factory queue add <spec.yaml>          Add a spec to the queue
factory queue start                    Process all pending items autonomously
factory queue stats                    Show queue statistics
factory queue clear                    Clear completed items
factory queue retry <id>               Retry a failed item
factory queue remove <id>              Remove an item from queue

factory worker --queue <file>          Run YAML prompt queue natively
factory worker default-cli [cli]       Get/set default CLI (pi, gemini, claude, agy)
```

## Conventions

- **Engine**: Pure TypeScript, runs via `npx tsx`. No transpilation step.
- **UI**: Next.js 15 with App Router, shadcn/ui, Tailwind CSS.
- **State**: SQLite for queue/builds (`factory.db`), JSON for projects (`projects.json`).
- **Specs**: YAML, validated against typed schemas defined in `types.ts`.
- **Notifications**: Sonner toasts for UI feedback.
- **API**: Next.js API routes at `/api/*` that invoke engine CLI or read from DB/files.

## Common Tasks

### Adding a new spec field

1. Update type in `engine/types.ts` (AppSpec or FeatureSpec)
2. Update `engine/spec.ts` → `validateSpec()` to check the field
3. Update `engine/generate.ts` prompts to use the field in code generation
4. Update `specs/apps/_template.yaml` with an example

### Adding a new engine module

1. Create `engine/<module>.ts`
2. Export functions, import in `engine/cli.ts`
3. Add CLI command handler in the `switch` statement
4. Add API route in `ui/src/app/api/` if UI access needed

### Adding a new UI feature

1. Create component in `ui/src/components/`
2. Add API route in `ui/src/app/api/` if backend needed
3. Wire into `dashboard.tsx`
4. Add to sidebar navigation

---

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
