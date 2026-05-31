# Factory — Agent Instructions

## Role

You are a senior TypeScript/Node.js engineer working on the Factory build engine — an autonomous TPM-driven build system that delegates code generation to CLI agents (agy, gemini, claude, pi).

## Stack

| Layer | Technology |
|-------|----------|
| Runtime | Node.js (npx tsx) — no transpilation step |
| Frontend | Next.js 15 + App Router |
| Styling | Tailwind CSS + Shadcn/UI |
| State | YAML files (`queue.yaml`, `builds.yaml`) + JSON (`projects.json`, `settings.json`) |
| Language | TypeScript 5, strict mode |
| Package Manager | npm |
| Context Format | YAML (with optional TOON encoding via `@toon-format/toon`) |
| CLI Delegation | TPM orchestrator → CLI agents (agy/gemini/claude/pi) |
| LLM Engine | Tool-calling orchestrator loop with CLI delegation |

## Quick Commands

```bash
# Engine
npx tsx engine/cli.ts build <story.yaml>
npx tsx engine/cli.ts validate <story.yaml>
npx tsx engine/cli.ts status
npx tsx engine/cli.ts queue list
npx tsx engine/cli.ts queue start

# CLI facade
factory pulse "<msg>"
factory task list
factory blueprint update "<msg>"
factory validate
factory worker --queue <file>
factory worker default-cli <cli-name>
factory hooks install
factory repl <provider>
factory chronicle distill

# Agentic scripts
FACTORY_PROJECT_ROOT=$(pwd) factory/scripts/heartbeat/pulse.sh "<msg>"
FACTORY_PROJECT_ROOT=$(pwd) factory/scripts/heartbeat/check.sh
FACTORY_PROJECT_ROOT=$(pwd) factory/scripts/auto-blueprint/update-blueprint.sh "<msg>"
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
│   ├── cli.ts             ← CLI entry point & command dispatcher (1,900+ lines)
│   ├── config.ts          ← projects.json, settings.json, factory.yaml loading
│   ├── story.ts           ← Load, validate, update status of YAML stories
│   ├── blueprint.ts       ← Gather knowledge, conventions & project context
│   ├── orchestrate.ts     ← TPM orchestrator: LLM loop → CLI delegation → monitoring
│   ├── generate.ts        ← LLM API client (callProviderWithTools) + pipeline wrappers
│   ├── cli-adapter.ts     ← CLI binary resolution (agy, gemini, claude, pi)
│   ├── writer.ts          ← File writer, npm install, git ops, knowledge feedback
│   ├── db.ts              ← Build logs (YAML-based, replaces SQLite)
│   ├── queue.ts           ← Dependency-aware queue (YAML-based)
│   ├── health.ts          ← State audit, heartbeat, error categorisation
│   ├── chronicle.ts       ← Auto-distill build history into knowledge context
│   ├── rollup.ts          ← Scaffold.yaml sync & progress rollup
│   ├── skills.ts          ← Skill registry and execution
│   ├── init.ts            ← Project initialisation & bridge setup
│   ├── toon.ts            ← TOON/YAML read/write helpers, heartbeat writer
│   ├── build-tools.ts     ← Build tool definitions for LLM tool-calling
│   ├── worker-engine.ts   ← Worker engine for YAML prompt queue processing
│   ├── daemon.ts          ← Daemon lifecycle (start/stop)
│   ├── repl.ts            ← Interactive REPL for LLM providers
│   ├── types.ts           ← All shared TypeScript types
│   └── log.ts             ← Structured coloured logging
├── ui/                    ← Next.js dashboard (port configured in start.sh)
│   └── src/
│       ├── app/
│       │   └── api/       ← API routes (stories, build, validate, queue, tpm/chat)
│       └── components/    ← Dashboard, sidebar, story editor, queue view, etc.
├── start.sh               ← Start script (UI on port 11498 by default)
├── package.json           ← Root dependencies
└── tsconfig.json          ← TypeScript config
```

## Engine Modules

| Module               | Responsibility                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `cli.ts`             | Parses CLI args, dispatches to handlers (build, validate, queue, project, daemon, repl, etc.) |
| `config.ts`          | Reads/writes `projects.json`, `settings.json`, `.factory/factory.yaml`                       |
| `story.ts`           | Loads YAML stories, validates schemas, updates story `status` field in-place, archives done   |
| `blueprint.ts`       | Gathers knowledge files, conventions, chronicle, build logs for LLM context                  |
| `orchestrate.ts`     | TPM orchestrator: builds system prompt, runs LLM tool-calling loop, delegates to CLI agents  |
| `generate.ts`        | LLM API client (`callProviderWithTools` for Gemini/OpenAI/Ollama) + thin pipeline wrappers   |
| `cli-adapter.ts`     | Resolves CLI binaries (agy, gemini, claude, pi), builds invocation args, manages PATH/env    |
| `writer.ts`          | Writes files, runs `npm install`, git commit/push, knowledge entries, AGENTS.md generation   |
| `db.ts`              | Build log storage via YAML (`~/.factory/builds.yaml`)                                        |
| `queue.ts`           | YAML-based queue: enqueue, dequeue (phase + dependsOn gating), daemon loop, stats            |
| `health.ts`          | State audit (zombie detection), heartbeat management, error categorisation                   |
| `chronicle.ts`       | Auto-distills build history + knowledge into compressed context for future builds             |
| `rollup.ts`          | Syncs scaffold.yaml progress from story file statuses, calculates percentages                |
| `skills.ts`          | Skill registry: load, list, execute agentic skills                                           |
| `init.ts`            | Project initialisation: scaffold.yaml generation, story decomposition from requirements      |
| `toon.ts`            | TOON encoding/decoding helpers, heartbeat writer, task snapshot writer                       |
| `build-tools.ts`     | Tool definitions exposed to the LLM during orchestration                                     |
| `worker-engine.ts`   | Processes YAML prompt queues via configured CLI                                              |
| `daemon.ts`          | Daemon lifecycle management (start/stop/install/uninstall as LaunchAgent)                    |
| `repl.ts`            | Interactive REPL for testing LLM providers directly                                          |
| `types.ts`           | AppStory, FeatureStory, ProjectBlueprint, BuildResult, FactorySettings, LLMProvider          |
| `log.ts`             | Coloured step/error/success logging                                                          |

## Build Pipeline

The engine uses a **TPM (Technical Program Manager) orchestrator** pattern:

```
CLI entry (cli.ts)
  → Load story (story.ts)
  → Validate story
  → Gather blueprint (blueprint.ts) — knowledge, conventions, chronicle
  → Orchestrate (orchestrate.ts):
      → Build system prompt with full context
      → LLM tool-calling loop (max 12 turns):
          → delegate_to_cli: spawn CLI agent (agy/gemini/claude/pi)
              → Stream monitor: stall/loop/question/rate-limit detection
              → Returns: DELIVERED / FAILED / INTERVENTION
          → intervene: re-brief CLI after failure (max 1 per story)
          → mark_story_done: update status + write receipt
          → mark_story_failed: update status + create fix story
          → create_fix_task: write fix YAML + re-enqueue with high priority
          → create_qa_task: write QA story at phase 99
  → Git commit & push
  → Archive story to done/
  → Distill chronicle (dynamic context accumulation)
```

### How CLI Delegation Works

The orchestrator is an LLM acting as a TPM. It does NOT write code. Instead:

1. It writes a complete brief with acceptance criteria, stack, conventions
2. Delegates to the configured CLI agent (agy, gemini, claude, or pi)
3. Monitors the CLI session for dysfunction:
   - **STALL**: No output for 5+ minutes → kill and intervene
   - **LOOP**: Output unchanged for 3 check intervals → kill and intervene
   - **ASKING**: CLI asks for user input → kill and intervene with the answer
   - **RATE_LIMIT**: Quota exhausted → kill and suggest switching CLI
4. Detects `DELIVERY COMPLETE` in output → resolves immediately and kills process group
5. Makes the go/no-go call: mark_story_done, create_fix_task, or mark_story_failed

### Post-Build

After the CLI agent writes files directly to disk, the engine:

1. Runs `npm install` in the target app directory
2. Generates `AGENTS.md` inside the app with stack, structure, and conventions
3. Writes a knowledge entry to `.factory/logs/builds/` for future context
4. Commits and pushes
5. Archives the story file to `done/`

## Story Status Lifecycle

```
draft → ready → in-progress → done | review
```

Updated in the YAML file itself via `updateStoryStatus()`.

## Key Concepts

### .factory Bridge

The `.factory/` folder inside a connected project repo. Single source of truth for planning and agent context:

```
.factory/
├── scaffold.yaml          ← Planning spec: features → stories (the ONE file the board reads)
├── factory.yaml           ← Bridge config: stack, conventions, knowledge paths
├── stories/
│   ├── apps/              ← App scaffold stories (bootstrap the project)
│   ├── features/          ← Feature stories (individual feature builds)
│   └── done/              ← Archived completed stories
├── knowledge/             ← Agent-authored ADRs, decisions, conventions for future runs
├── logs/                  ← Machine-written runtime output (never hand-edit)
│   ├── heartbeat.yaml     ← Liveness signal (written by engine + pulse.sh)
│   ├── worklog.yaml       ← Append-only session log
│   ├── builds/            ← Build receipts written after each successful build
│   └── failures/          ← Failure records for debugging
├── blueprint/
│   └── chronicle.md       ← Auto-distilled project context from build history
├── task-manager/
│   ├── todo.yaml          ← Task queue
│   └── manage.sh          ← Task lifecycle CLI
└── workflows/             ← Workflow markdown scripts
```

### scaffold.yaml

The planning spec at `.factory/scaffold.yaml`. Contains features with inline stories. Each story points to a file in `.factory/stories/features/`. This is what the Factory dashboard board reads.

Valid story `status` values: `draft` | `in-progress` | `done` (never `todo`, `pending`, `completed`, `unknown`).

### Scaffold Epic (Bootstrap Pattern)

Every new project MUST have a `⚙️ Scaffold & Foundation` epic as the **first** feature in scaffold.yaml. It contains a single AppStory (`stories/apps/<app-name>.yaml`) that bootstraps the project structure.

```yaml
features:
  - name: "⚙️ Scaffold & Foundation"
    scaffold: true    # marks this as the bootstrap epic
    priority: 0       # always first
    stories:
      - name: "Scaffold <app-name> project"
        file: .factory/stories/apps/<app-name>.yaml
  # ... feature epics follow
```

**Bootstrap guard in `factory.yaml`:**
```yaml
project:
  bootstrapped: false  # false = feature builds blocked until scaffold completes
                       # true  = existing project, no gate
```

- `bootstrapped: false` → new project; the engine blocks feature stories until the AppStory builds
- `bootstrapped: true` → existing project; features build immediately with no gate
- The engine writes `bootstrapped: true` automatically after a successful AppStory build
- Set manually to `true` when connecting a pre-built existing project

### Queue

YAML-based (`~/.factory/queue.yaml`) build queue. Items: `pending → running → completed | failed`. Supports:
- **Phase ordering**: Lower phase numbers build first
- **Dependency gating**: `dependsOn` slugs checked before building
- **Auto-blocking**: Items with failed dependencies are auto-blocked
- **Retry**: Reset failed items to pending with `factory queue retry <id>`
- **Daemon mode**: Persistent polling loop with auto-retry and exponential backoff

### Knowledge

The `.factory/knowledge/` directory is for **agent-authored reference material** — Architecture Decision Records, key technical decisions, established conventions. The engine injects these into LLM prompts so future builds are context-aware. Build receipts go to `.factory/logs/builds/` (not knowledge).

### Chronicle

The chronicle system (`chronicle.ts`) auto-distills build history and knowledge into a compressed context document at `.factory/blueprint/chronicle.md`. This grows over time as the project evolves, giving future builds a summary of architectural decisions and what was built.

## CLI Commands

```
factory build <story.yaml>              Full orchestrator pipeline
factory validate <story.yaml>           Validate a story
factory status                          Show story statuses
factory sync <repo-path>                Sync .factory from repo
factory init-bridge <repo-path>         Init .factory bridge in repo

factory project add <repo-path>         Connect a repo
factory project list                    List connected repos
factory project switch <id>             Switch active project
factory project remove <id>             Disconnect a repo
factory project reset [<repo-path>]     Reset all stories to draft

factory feature build <story.yaml>      Build a feature
factory feature validate <story.yaml>   Validate a feature story

factory queue list                      List all queue items
factory queue add <story.yaml>          Add a story to the queue
factory queue start                     Process all pending items autonomously
factory queue stats                     Show queue statistics
factory queue clear                     Clear completed items
factory queue retry <id>                Retry a failed item
factory queue remove <id>               Remove an item from queue
factory queue daemon start              Start persistent queue daemon
factory queue watch start               Start file-watching queue

factory worker --queue <file>           Run YAML prompt queue natively
factory worker default-cli [cli]        Get/set default CLI (pi, gemini, claude, agy)

factory pulse "<msg>"                   Write liveness heartbeat
factory task list                       Show task queue
factory blueprint update "<msg>"        Append to worklog
factory repl <provider>                 Interactive LLM REPL
factory chronicle distill               Distill build history to chronicle
factory hooks install                   Install git hooks
```

## Conventions

- **Engine**: Pure TypeScript, runs via `npx tsx`. No transpilation step.
- **UI**: Next.js 15 with App Router, shadcn/ui, Tailwind CSS.
- **State**: YAML files for queue/builds (`~/.factory/`), JSON for projects/settings (`~/.factory/`).
- **Stories**: YAML, validated against typed schemas defined in `types.ts`.
- **Notifications**: Sonner toasts for UI feedback.
- **API**: Next.js API routes at `/api/*` that invoke engine functions or read from YAML/JSON files.

## Common Tasks

### Adding a new story field

1. Update type in `engine/types.ts` (AppStory or FeatureStory)
2. Update `engine/story.ts` → `validateStory()` to check the field
3. Update `engine/orchestrate.ts` prompts to use the field in context
4. Update story template with an example

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
| `.factory/scaffold.yaml` | Planning spec — features → stories (board reads this) |
| `.factory/factory.yaml` | Bridge config — stack, conventions, knowledge paths |
| `.factory/stories/features/*.yaml` | Individual story detail files |
| `.factory/stories/apps/*.yaml` | App scaffold stories |
| `.factory/stories/done/*.yaml` | Archived completed stories |
| `.factory/knowledge/` | Agent-authored ADRs and decisions (future context) |
| `.factory/blueprint/chronicle.md` | Auto-distilled project context |
| `.factory/logs/heartbeat.yaml` | Liveness signal (written every build step) |
| `.factory/logs/worklog.yaml` | Append-only session log |
| `.factory/logs/builds/` | Build receipts |
| `.factory/logs/failures/` | Failure records |
| `.factory/task-manager/todo.yaml` | Task queue |
| `.factory/task-manager/manage.sh` | Task lifecycle CLI |

### Workflow

1. Start: `factory task start <id>` → `factory pulse "starting <id>"`
2. Work: agent reads context, builds, writes heartbeat on each step
3. Done: `factory task complete --id <id> --summary "what was done"`
4. Commit: `git add -A && git commit -m "feat(scope): what and why"`
