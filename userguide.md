# How the Factory Works

> The Factory is an autonomous build engine. You describe what you want in a YAML story file, queue it up, and walk away. While you sleep, a TPM orchestrator delegates to CLI agents (agy, gemini, claude, pi), monitors for dysfunction, self-corrects, and pushes working code to your repo.

---

## The Big Picture

```
You write a story → Queue it → Factory builds it → You wake up to working code
```

There are **three actors** in this system:

1. **You** — write stories, configure the project, hit "start"
2. **The Engine** — reads your stories, orchestrates the TPM, delegates to CLI agents, writes the code
3. **The CLI Agents** (agy, gemini, claude, pi) — do the actual code generation

---

## Step by Step

### 1. Connect Your Repository

Before anything happens, the Factory needs to know where your code lives.

```
factory project add /path/to/your/repo
```

This registers the repo in `projects.json`. The Factory will read from and write to this directory. You can connect multiple repos and switch between them.

The repo should have a `.factory/` folder containing:

- `factory.yaml` — project-level config (stack, conventions, knowledge paths)
- `stories/apps/` — YAML stories for entire applications
- `stories/features/` — YAML stories for individual features

---

### 2. Write a Story

A story is a YAML file that describes what you want built. Here's a simple one:

```yaml
appName: "Inventory Tracker"
description: "A web app to track warehouse inventory with barcode scanning"

stack:
  framework: next.js
  packageManager: pnpm
  language: typescript
  linter: eslint
  testing: vitest

auth:
  provider: firebase
  methods:
    email: true
    google: true

data:
  tables:
    - name: items
      fields:
        name: { type: string, required: true }
        sku: { type: string, required: true }
        quantity: { type: number, default: 0 }
        location: { type: string }

pages:
  dashboard: ["overview", "recent-activity"]
  crud: [{ table: items }]

status: draft
```

The `stack` section is critical — it tells the engine and CLI agents which tools to use for building, linting, and testing.

### 2b. AI-Assisted Story Creation

Instead of writing YAML by hand, you can use the **Story Editor** in the dashboard UI to create and edit stories interactively.

---

### 3. Queue It Up

You can build one story at a time:

```
factory build stories/apps/inventory-tracker.yaml
```

Or — the real power — queue up multiple stories for autonomous processing:

```
factory queue add stories/apps/inventory-tracker.yaml
factory queue add stories/features/auth-system.yaml
factory queue add stories/features/barcode-scanner.yaml
factory queue start
```

The last command kicks off the autonomous loop. The Factory will process every queued item, one after another, without stopping.

> **Dependency-aware ordering**: Feature stories can declare `phase` (1 = foundation, 2 = core, 3 = polish) and `dependsOn` (a list of story slugs that must complete first). The queue processes items in phase order and skips any story whose dependencies haven't completed yet. When all processable items are done, it reports which stories remain blocked and why.

---

### 4. What Happens Inside

When you run `queue start`, here's exactly what happens for each story:

#### 4a. Gather Context

The engine reads:

- The story YAML itself
- `factory.yaml` — your project's stack, conventions, and structure
- **Knowledge files** — agent-authored ADRs and decisions in `.factory/knowledge/`
- **Chronicle** — auto-distilled project context from previous builds (`.factory/blueprint/chronicle.md`)
- **Build logs** — receipts from previous builds for context continuity
- **Conventions** — rules about naming, file structure, imports

All of this is bundled into a **blueprint** that gets sent to the TPM orchestrator alongside the story.

#### 4b. Validate

The engine checks the story for schema issues before burning LLM tokens. Stories are validated against typed schemas defined in `types.ts`.

If validation fails, the story is marked as `review` and the engine moves on to the next item in the queue.

#### 4c. Orchestrate

The TPM orchestrator (`orchestrate.ts`) takes over. It acts as a **Technical Program Manager** — it does NOT write code itself. Instead:

1. **Builds a system prompt** with the full blueprint context (knowledge, conventions, chronicle)
2. **Writes a complete brief** with acceptance criteria, stack, and conventions
3. **Delegates to the configured CLI agent** (agy, gemini, claude, or pi) via `cli-adapter.ts`
4. **Monitors the CLI session** for dysfunction in real-time

#### 4d. Stream Monitoring

While the CLI agent works, the orchestrator monitors its output stream for dysfunction:

| Condition       | Detection                              | Action                              |
| --------------- | -------------------------------------- | ----------------------------------- |
| **STALL**       | No output for 5+ minutes               | Kill and intervene with re-briefing |
| **LOOP**        | Output unchanged for 3 check intervals  | Kill and intervene                  |
| **ASKING**      | CLI asks for user input                 | Kill and intervene with the answer  |
| **RATE_LIMIT**  | Quota exhausted                         | Kill and suggest switching CLI      |
| **DELIVERED**   | `DELIVERY COMPLETE` detected in output  | Resolve immediately                 |

#### 4e. Go/No-Go Decision

After the CLI session completes, the TPM makes a decision:

- **`mark_story_done`** — Story succeeded; update status, write receipt
- **`create_fix_task`** — Something needs fixing; write a fix YAML, re-enqueue with high priority
- **`mark_story_failed`** — Story failed beyond recovery; update status
- **`intervene`** — Re-brief the CLI after a failure (max 1 per story)

The LLM tool-calling loop runs up to **12 turns** per story.

#### 4f. Post-Build

After the CLI agent writes files directly to disk, the engine:

1. Runs `npm install` in the target app directory
2. Generates `AGENTS.md` inside the app with stack, structure, and conventions
3. Writes a knowledge entry to `.factory/logs/builds/` for future context
4. Commits and pushes
5. Archives the story file to `done/`
6. Distills chronicle (dynamic context accumulation)

---

### 5. What Gets Tracked

Throughout the process, the engine maintains state in multiple places:

#### Story Status (in the YAML file itself)

```
draft → ready → in-progress → done
                             → review (if failed)
```

You can check this from the UI or by looking at the story file.

#### Queue State (in `~/.factory/queue.yaml`)

Each queue item tracks:

- Status: `pending` → `running` → `completed` / `failed`
- Phase and dependencies (`dependsOn` slugs)
- Start time, end time, duration
- Output logs
- Error messages (if any)

The queue dequeues in **phase order** and only processes items whose `dependsOn` stories are all `completed`.

#### Build History (in `~/.factory/builds.yaml` and `.factory/logs/builds/`)

Every build is logged with:

- Which story was built
- How many files were generated
- How long it took
- Whether it succeeded or failed
- The full output

This history is stored as YAML and also distilled into the chronicle for future build context.

---

### 6. The UI

The Factory has a web UI that gives you visibility into everything:

- **Dashboard** — overview of connected projects and stories
- **Story Editor** — create and edit story YAML files
- **Queue View** — see what's queued, running, completed, or failed
- **Build History** — browse past builds and their results
- **Settings** — configure LLM providers, API keys, models

The UI reads directly from the same files the engine uses — `projects.json`, `settings.json`, YAML state files, and the story YAMLs. When you click "Start Queue" in the UI, it calls the same `engine/cli.ts build` command under the hood.

---

## The Engine Files

| File                 | What it does                                                                     |
| -------------------- | -------------------------------------------------------------------------------- |
| `cli.ts`             | Receives commands, dispatches to the right handler                               |
| `config.ts`          | Reads/writes project settings, factory.yaml                                      |
| `story.ts`           | Loads stories, validates them, updates their status                              |
| `blueprint.ts`       | Gathers knowledge, conventions, chronicle, build logs for LLM context            |
| `orchestrate.ts`     | TPM orchestrator: builds system prompt, runs LLM tool-calling loop               |
| `generate.ts`        | LLM API client (`callProviderWithTools`) + pipeline wrappers                     |
| `cli-adapter.ts`     | Resolves CLI binaries (agy, gemini, claude, pi), builds invocation args          |
| `writer.ts`          | Writes files to disk, runs npm install, handles git, knowledge feedback          |
| `db.ts`              | Build log storage via YAML (`~/.factory/builds.yaml`)                            |
| `queue.ts`           | Queue operations (dependency-aware dequeue, enqueue, status) via YAML            |
| `health.ts`          | State audit (zombie detection), heartbeat management, error categorisation       |
| `chronicle.ts`       | Auto-distills build history + knowledge into compressed context                  |
| `rollup.ts`          | Syncs scaffold.yaml progress from story file statuses                            |
| `skills.ts`          | Skill registry: load, list, execute agentic skills                               |
| `init.ts`            | Project initialisation: scaffold.yaml generation, story decomposition            |
| `toon.ts`            | TOON/YAML read/write helpers, heartbeat writer                                   |
| `build-tools.ts`     | Tool definitions exposed to the LLM during orchestration                         |
| `worker-engine.ts`   | Processes YAML prompt queues via configured CLI                                  |
| `daemon.ts`          | Daemon lifecycle management (start/stop)                                         |
| `repl.ts`            | Interactive REPL for testing LLM providers directly                              |
| `types.ts`           | TypeScript types shared across all modules                                       |
| `log.ts`             | Colored, structured logging                                                      |

### UI / API

| File                                | What it does                                                 |
| ----------------------------------- | ------------------------------------------------------------ |
| `ui/src/components/spec-chat.tsx`   | Spec Generator dialog: chat UI, spec preview, save/enqueue   |
| `ui/src/app/api/chat/route.ts`      | LLM-powered spec generation with repo context injection      |
| `ui/src/app/api/repo-scan/route.ts` | Scans active project: deps, stack, file tree, existing specs |
| `ui/src/app/api/specs/route.ts`     | Save and list spec YAML files                                |

---

## Key Design Decisions

1. **Platform agnostic** — The engine has no hardcoded knowledge about any specific project. Everything comes from `factory.yaml` and the spec.

2. **TPM-driven orchestration** — The engine's LLM acts as a Technical Program Manager. It doesn't write code — it briefs CLI agents, monitors their sessions for dysfunction, and makes go/no-go decisions.

3. **Self-correcting** — When a CLI session fails, the TPM can intervene with a re-briefing or create fix tasks that are re-enqueued with high priority.

4. **Stream monitoring** — The engine monitors CLI agent output for stalls, loops, rate limits, and questions — automatically killing and re-briefing when dysfunction is detected.

5. **Integration-aware** — Feature builds read the target app's package.json, tsconfig, and file tree. The CLI agents know what exists and generate complementary code.

6. **Chronicle-driven context** — Build history is automatically distilled into a compressed context document (`chronicle.md`), so future builds are informed by past decisions and architecture.

7. **Queue-first** — The whole system is designed around batch processing. Queue up 10 stories, start it, go to bed. Wake up to 10 committed applications.

8. **Your tools, your rules** — The engine uses whatever linter, test runner, and package manager you choose in the story. ESLint or Biome. Vitest or Jest. npm or pnpm. Your call.

9. **Dependency-aware scheduling** — Feature stories declare `phase` and `dependsOn`. The queue builds foundation stories first and waits for dependencies to complete before building dependent stories. You can queue everything at once — the engine figures out the right order.

---

## Known Build Diagnostics

Lessons learned from verifying factory-built projects (e.g. ubot-core, 135 source files):

### Issue 1: Missing Packages in package.json

LLM-generated code often imports packages (`dotenv`, `uuid`, `puppeteer`, `react`, etc.) without listing them in `package.json`. The engine now runs a **Phase 1.5 structural check** that scans every `.ts`/`.tsx`/`.js`/`.jsx` file for `import ... from 'pkg'` and cross-references against `package.json` dependencies. Missing packages are flagged before toolchain validation.

### Issue 2: Cross-Module Export Mismatches

When multiple features are built independently, they generate inconsistent import/export styles:

- File A does `export default router` but File B does `import { router } from './a'`
- A barrel file exports `getDatabase()` but consumers import `{ db }`
- Class exported as `SkillRegistryImpl` but imported as `SkillRegistry`

The build prompt now includes explicit rules (rules #11-12) requiring consistent cross-module references.

### Issue 3: Overly Strict tsconfig

LLM-generated code rarely satisfies `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, or `noFallthroughCasesInSwitch`. The prompt now instructs the LLM to avoid enabling these flags (rule #13).

### Issue 4: ESM Extension Requirements

With `moduleResolution: "NodeNext"`, all relative imports must include `.js` extensions. The prompt now includes this guidance (rule #14).

### Issue 5: Native Module Version Compatibility

Packages with native C++ bindings can break with newer Node.js versions. Always verify native module compatibility with the target Node.js version.
