# Knowledge Document: Factory

## Project Overview

Factory is an autonomous, TPM-driven build engine that generates production-ready applications from declarative YAML stories. A Technical Project Manager (TPM) orchestrator delegates code generation to CLI agents (agy, gemini, claude, pi), monitors for dysfunction, self-corrects, and pushes working code to the repository — all without human intervention.

The project is structured as a **TypeScript CLI tool** with an optional web dashboard (Next.js). It relies on LLM providers (Gemini, OpenAI, Ollama) for agentic reasoning and code generation.

**Key goals:**
- Write a story in YAML → Queue it → Factory autonomously builds, validates, and pushes code.
- Dependency-aware queue with phase ordering (`dependsOn`).
- Built-in dysfunction detection (stalls, loops, rate limits, questions).
- Chronicle system: auto-distills build history into compressed context for future builds.

## Tech Stack

| Layer            | Technologies                                                                 |
|------------------|-------------------------------------------------------------------------------|
| Runtime          | Node.js ≥ 18, TypeScript 5.x                                                 |
| CLI Framework    | Commander v13.1.0, chalk v5.3.0                                              |
| Configuration    | Custom JSON/TOON settings, YAML for stories                                    |
| Schema Validation| Zod v4, AJV v8                                                               |
| LLM Providers    | Google Gemini, OpenAI, Ollama (local)                                        |
| Agent Protocol   | @agentclientprotocol/sdk v0.26, @earendil-works/pi-coding-agent v0.79        |
| File Format      | TOON v2.2 (structured context), YAML, gray-matter                             |
| State Management | Zustand v5 (dashboard)                                                        |
| Database         | TODO (likely SQLite or similar, not yet defined)                             |
| Build Tools      | custom file system tools, glob v11, proper-lockfile v4                       |
| Linting          | ESLint 9 with TypeScript parsers                                             |
| Testing          | None visible yet; validation performed via TS compiler & linting agents      |

**Additional dependencies from package.json:**
- `yaml` v2.4.0 (YAML parsing)
- `tsx` v4.19.0 (TypeScript execution for scripts)
- Development: `@types/node`, `@types/proper-lockfile`, `@typescript-eslint/*`

## Architectural Paradigm

### Core Concepts

- **TPM Orchestrator** — An LLM instance acting as a Technical Project Manager. It receives the YAML story, creates a phased build plan, delegates work to CLI agents, monitors sessions, and makes go/no-go decisions.
- **CLI Delegation** — Code generation is delegated to external CLI agents (agy, gemini, claude, pi). The TPM briefs each agent, streams output, monitors for dysfunction (stalls, loops, rate limits, questions), and intervenes if needed.
- **Tool-Calling Loop** (ADR-001) — The LLM engine now uses an agentic tool-calling loop instead of the rigid linear pipeline. The generator has access to the filesystem, compiler, and tests during generation, enabling it to check existing files, verify imports, and correct errors autonomously without returning to a separate validation step.
- **Dependency-Aware Queue** — Stories can declare `dependsOn` phases. The queue processes stories respecting these dependencies, allowing complex multi-app builds to be queued and resolved automatically.
- **Chronicle System** — After each build, the engine distills key decisions, failures, and workarounds into a compressed context file (`chronicle.md`) used in future builds to avoid repeating mistakes.

### Key Files & Architecture

```
engine/
  cli.ts                 — main entry point
  cli-adapter.ts         — adapts CLI commands to core logic
  cli-session.ts         — manages user session state
  config.ts              — reads settings.json
  db.ts                  — database abstraction
  generate.ts            — generates code via LLM tool calls
  orchestrate.ts         — TPM orchestration logic
  story.ts               — story parsing and validation
  worker-engine.ts       — async task execution engine
  writer.ts              — writes generated files to disk
  chronicle.ts           — distills build history
  schemas.ts             — Zod schemas for stories
  init.ts                — initializes .factory bridge
  analyze.ts             — static analysis of project
  build-tools.ts         — build helpers
  blueprint.ts           — blueprint generation
  toon.ts                — TOON format handling
  skills.ts              — skill registry
  log.ts                 — logging utilities
  repl.ts                — interactive REPL (for debugging)
  types.ts               — core types
  acp-client.ts          — ACP (Agent Client Protocol) client
  cli/
    build-handlers.ts
    facade-handlers.ts
    feature-handlers.ts
    project-handlers.ts
    queue-handlers.ts
    service-handlers.ts
  tools/
    fs/                  — filesystem tool implementations
    fs.ts                — filesystem tool definitions
    registry.ts          — tool registry
    tpm/                 — TPM-specific tools (audit, context, escalate, scope, skills)
      audit.ts
      context.ts
      escalate.ts
      index.ts
      orchestration.ts
      scope.ts
      skills.ts
    types.ts
  skills/                — skill definitions (directory present, contents not shown)
```

### Flow

1. User writes a YAML story in the project's `.factory/stories/` directory.
2. User runs `factory build <story>` or adds to queue and starts processing.
3. TPM parses story, creates build phases (e.g., scaffold, implement, test).
4. For each phase, TPM delegates to a CLI agent with explicit instructions.
5. Agent runs tool calls (read/write files, compile, lint, test) in a loop.
6. TPM monitors agent output for dysfunction; intervenes (e.g., heartbeat, reset).
7. After phase completes, TPM validates, records chronicle, moves to next phase.
8. Final validation: TypeScript compilation, linting, tests must pass.
9. On success, code is pushed to repository (or staged for review).

## New Features / Approach Changes (since v1.0)

- **Tool-Calling Loop** (ADR-001) — Replaced rigid linear pipeline with agentic tool-calling loop. Generator now has file system and compiler access during generation, enabling autonomous error correction.
- **CLI Facade** — Refactored CLI into handler files per command category (build, queue, project, feature, service). Commands dispatch to dedicated handlers.
- **Queue System** — `queue add`, `queue list`, `queue start`, `queue stats`, `queue retry` commands. Supports dependency resolution via `dependsOn`.
- **Feature Builds** — `feature build <story>` builds a feature story into an existing app (separate from full app builds).
- **Project Management** — `project add`, `project list`, `project switch`, `project remove`. Manages multiple connected repositories.
- **Chronicle System** — Auto-distills build history into compressed context for future builds, improving consistency.
- **Multi-Provider LLM Support** — Gemini, OpenAI, Ollama (local). Configurable per session.
- **Web Dashboard** — Next.js UI (port 3001/4090) for story management, queue monitoring, build history, and settings.

## Anti-Patterns & Post-Mortems

### 1. YAML Parse Errors Due to Missing Files
**Failure:** `q-1779432840844-o358xg` — Feature story not found at expected path.
**Root Cause:** Story path was incorrectly specified or file not created before queueing.
**Fix:** Always validate story existence before adding to queue. Implement pre-queue validation hook.

### 2. Ollama Subscription & Model Errors
**Failure:** Multiple builds (`q_form_validation`) failed with 403/Ollama subscription error.
**Root Cause:** Ollama model required a subscription (e.g., llama3 may require upgraded tier).
**Fix:** Check model availability before starting builds. Provide clear error message prompting user to switch to a free model or upgrade. Also handle 400 errors (malformed responses) gracefully — retry with backoff or switch provider.

### 3. Malformed JSON/TOON Responses from LLM
**Failure:** `q_form_validation` — "Value looks like object, but can't find closing '}' symbol" (400).
**Root Cause:** LLM generated incomplete or malformed JSON/TOON tool call arguments.
**Fix:** (a) Add retry logic with exponential backoff. (b) Implement a JSON/TOON repair layer that attempts to fix common syntax errors (missing braces, unescaped quotes). (c) If repair fails, escalate to TPM for re-prompting or fallback to a more reliable model.

### 4. Permanent vs. Unknown Error Categorization
**Anti-pattern:** Some failures are categorized as `unknown` because error parsing is insufficient.
**Fix:** Improve error categorization in `chronicle.ts` and `failure` record schema. Map common error patterns (rate-limit, auth, parse, timeout) to defined categories. Unmatched errors should be treated as "transient" and retried before marking permanent.

### 5. Missing Agent Resilience
**Anti-pattern:** Dysfunction detection exists but may not cover all cases (e.g., agent hangs without output, infinite loops).
**Fix:** Add heartbeat timeout (e.g., 5 min no output → restart agent). Monitor agent progress per tool call step; if same tool called > N times without file progress, escalate.

### 6. Over-reliance on Single Provider
**Anti-pattern:** Some builds fail because a provider is temporarily unavailable or rate-limited.
**Fix:** Implement fallback provider chain in settings. TPM should automatically try next provider if current one fails.

### 7. Lack of Pre-Queue Validation (Path & Model)
**Failure:** Stories added to queue with invalid paths or unavailable models led to immediate failures.
**Fix:** Implement pre-queue validation that checks story file existence, model availability, and provider subscription status before enqueuing.

### 8. TOON Argument Parsing Fragility
**Failure:** 400 errors due to malformed TOON tool call arguments (e.g., missing closing brace).
**Root Cause:** LLMs occasionally produce syntax errors in structured output.
**Fix:** Implement a TOON repair utility (e.g., auto-close braces, fix quotes) and add retry logic with exponential backoff. Consider switching to a more structured output format (e.g., JSON with strict schema) for tool calls.

## Running History

- **2026-05-22** — ADR-001 implemented: tool-calling loop replaces linear pipeline. CLI facade refactored. Queue system added. Feature builds added. Multi-provider support expanded.
- **2026-05-22** — Multiple build failures discovered related to Ollama subscription and malformed responses. Post-mortems recorded in `q-*` failure files.
- **2026-05-22** — Chronicle system finalized. First compressed context generated.
- **2026-05-22** — Identified need for pre-queue validation (story path + model availability) and TOON argument repair; fixes in progress.

*This document is maintained and updated as new architectural decisions and anti-patterns are discovered.*
