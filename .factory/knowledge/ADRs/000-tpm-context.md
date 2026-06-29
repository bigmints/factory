# TPM Context Document: Factory

## 1. Project Overview

**Factory** is an autonomous, TPM-driven build engine that generates production-ready applications from declarative YAML stories.  
A Technical Project Manager (TPM) orchestrator delegates code generation to CLI agents (agy, gemini, claude, pi), monitors for dysfunction, self-corrects, and pushes working code to the repository — all without human intervention.

The project is structured as a **TypeScript CLI tool** (entry point: `bin/factory`) with an optional web dashboard (Next.js, in the `ui/` directory, not shown in depth).  
It relies on LLM providers (Gemini, OpenAI, Ollama) for agentic reasoning and code generation.

Key goals:
- Write a story in YAML → Queue it → Factory autonomously builds, validates, and pushes code.
- Dependency-aware queue with phase ordering (`dependsOn`).
- Built-in dysfunction detection (stalls, loops, rate limits, questions).
- Chronicle system: auto-distills build history into compressed context for future builds.

## 2. Tech Stack

| Layer        | Technology                                                         |
|--------------|--------------------------------------------------------------------|
| Runtime      | Node.js >=18                                                       |
| Language     | TypeScript (compiled with `tsx` for dev)                           |
| CLI Framework| `commander` (v13)                                                  |
| LLM Integration| `@agentclientprotocol/sdk` (agent client), `@earendil-works/pi-coding-agent`, + custom providers (Gemini, OpenAI, Ollama) |
| Data Formats | YAML parsing (`yaml`, v2), JSON Schema (AJV), Zod (validation)     |
| State Management | Zustand (likely used in the web UI)                           |
| Build Tools  | TypeScript compiler, `tsx` (execution), eslint                     |
| File System  | `glob`, `gray-matter` (front matter), `proper-lockfile` (concurrency) |
| Logging/UI   | `chalk` for colored terminal output, `@toon-format/toon` for ASCII formatting? |

Notable packages:
- `@agentclientprotocol/sdk` – SDK for interacting with agentic CLI tools (agy, gemini, claude, pi).
- `@earendil-works/pi-coding-agent` – A specific LLM-powered coding agent.
- `zustand` – Used in the web UI dashboard (`ui/`) for state management.
- `gray-matter` – Parses YAML front matter from stories (possibly combined with markdown?).

## 3. Architecture & Structure

The repository is organized into several key areas:

### Root Files
- `README.md` – Project description, features, quick start.
- `AGENTS.md`, `CONTRIBUTING.md`, `LICENSE`, `SKILL.md`, `SPEC_GENERATION.md` – Supporting documentation.
- `package.json`, `eslint.config.js`, `tsconfig.json` (implied) – Build/lint configuration.
- `Makefile` – Likely shortcuts for common tasks (not visible in depth).

### `bin/` – Entry Points
- `factory` (shell script) – Launches the CLI.
- `factory.mjs` – The main executable (ES module wrapper for the TypeScript source).

### `engine/` – Core Application Logic
This is the heart of the project. Key subdirectories and files:

#### CLI Layer
- `cli.ts` – Main CLI entry point (Commander-based).
- `cli-adapter.ts` – Adapts CLI commands to internal handlers.
- `cli-session.ts` – Manages a CLI session (maybe for streaming output).
- `repl.ts` – Interactive REPL mode.

#### CLI Handlers (`engine/cli/`)
- `project-handlers.ts` – `project add/list/switch/remove` commands.
- `feature-handlers.ts` – `feature build/validate` commands.
- `build-handlers.ts` – `build` pipeline orchestration.
- `queue-handlers.ts` – `queue list/add/start/stats` commands.
- `service-handlers.ts` – Service commands (e.g., start/stop).
- `facade-handlers.ts` – Higher-level facade commands.

#### Core Engine
- `orchestrate.ts` – Central orchestrator that manages the TPM loop (delegates, monitors, decides go/no-go).
- `worker-engine.ts` – Possibly a lower-level execution engine for running CLI agents.
- `generate.ts` – Code generation logic.
- `blueprint.ts` – Blueprint generation from stories.
- `analyze.ts` – Analysis of build output/dysfunction.
- `config.ts` – Configuration loading (`settings.json`, provider setup).
- `db.ts` – Database interaction (likely SQLite or file-based for queue/stories).
- `schemas.ts` – Zod schemas for validation.
- `log.ts` – Logging utilities.
- `init.ts` – `init-bridge` command for project setup.
- `chronicle.ts` – Chronicle system for compressing build history.
- `story.ts` – Story file parsing and validation.
- `types.ts` – TypeScript interfaces.
- `toon.ts` – Formatting with `@toon-format/toon`.
- `writer.ts` – Writing generated code to disk.
- `build-tools.ts` – Build tool integration.

#### Skills (`engine/skills/`)
- `skills.ts` – Main skill management (loading skills?).
- `skills/` directory – Contains skill definitions (probably modular logic for different code generation tasks).

#### Tools (`engine/tools/`)
- `fs/` – Filesystem tools.
- `registry.ts` – Tool registry (listing/tracking available tools).
- `tpm/` – TPM-specific tools:
  - `audit.ts` – Audit logs.
  - `context.ts` – Context building for agents.
  - `escalate.ts` – Escalation handling.
  - `index.ts` – Exports.
  - `orchestration.ts` – Orchestration tools.
  - `scope.ts` – Scope management.
  - `skills.ts` – Skill invocation tools.
- `types.ts` – Tool type definitions.

#### Agent Protocol Client
- `acp-client.ts` – Wrapper for `@agentclientprotocol/sdk` to communicate with agent tools (e.g., `agy`).

### `docs/` – Architectural Decision Records
- `adr/001-agentic-tool-loop.md` – Describes the core agentic loop pattern.

### `factory/` – Scripts / Auxiliary
- `scripts/` – Utility scripts (exact content not shown).

### `ui/` (not shown in depth) – Web Dashboard
- Next.js frontend (port 3001 or 4090) for story management, queue monitoring, build history, settings.

## 4. Potential Focus Areas (For New Developers)

If you are new to this codebase, start with these areas to understand the core flow:

### a. **CLI Entry & Command Flow**
- `bin/factory.mjs` → `engine/cli.ts` sets up Commander commands.
- Follow `build <story>`: `build-handlers.ts` → `orchestrate.ts` → delegation.
- Understand how CLI handlers connect to the orchestrator.

### b. **TPM Orchestration (`engine/orchestrate.ts`)**
- The heart of the autonomous loop.
- See how it selects CLI agents, monitors streams (via `cli-session.ts`), and uses dysfunction detection (`dysfunction` logic likely in `analyze.ts`).
- The go/no-go decision (if an agent stalls or asks questions).

### c. **Agent & Tool Interaction**
- `engine/acp-client.ts` – How the SDK is used to run external agents (agy, gemini, claude, pi).
- `engine/tools/` – The tool registry and skill system (`skills.ts`). Understand how tools are registered and invoked.
- `engine/tpm/` – TPM-specific tools that help during orchestration (auditing, context building, escalation).

### d. **Queue System**
- `queue-handlers.ts` and `queue start` – Dependency-aware processing.
- Examine how `orchestrate.ts` picks items from the queue and respects `dependsOn`.
- The database layer (`db.ts`) likely stores queue state.

### e. **Chronicle & Context Management**
- `engine/chronicle.ts` – How build history is distilled and passed to future builds.
- The context is passed to LLM agents to ensure continuity.

### f. **Skill System**
- `engine/skills/` – Skill definitions that encapsulate code generation patterns.
- How skills are registered and invoked from the TPM loop.

### g. **Configuration & Validation**
- `engine/config.ts` – Loading providers and settings.
- `schemas.ts` + `story.ts` – Zod-based validation of YAML stories.
- The validation is invoked in `validate` and before build.

### h. **ADRs & Documentation**
- `docs/adr/001-agentic-tool-loop.md` – Explains the architectural decision behind the agent loop.
- `AGENTS.md`, `SKILL.md`, `SPEC_GENERATION.md` – Supplementary documentation that clarifies agent interaction, skill writing, and specification generation.

### i. **Build Pipeline**
- Trace the full pipeline: story YAML → validate → orchestrate → delegate → monitor → push.
- Look at `build-handlers.ts` for the top-level flow.

### j. **Testing & Linting**
- `eslint.config.js` and `tsconfig.json` – Code quality.
- The package.json scripts include `lint`, `typecheck`. No unit tests are apparent yet (may be added later).

---

**Start with:** `engine/orchestrate.ts`, `engine/tools/tpm/`, `engine/acp-client.ts`, and `docs/adr/001-agentic-tool-loop.md` to understand the core autonomous loop. Then explore the CLI handlers (`engine/cli/`) to see how commands are wired.