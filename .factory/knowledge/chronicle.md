# REPOSITORY ARCHITECTURAL CHRONICLE

This chronicle is a consolidated semantic history of the Factory build engine. It acts as a memory bridge for AI coding agents to preserve key context, stack choices, major milestones, and post-mortems of previous failures and learnings.

---

## 1. Architectural Context & Key ADR Highlights

The Factory platform orchestrates multi-agent tasks, spec validation, and autonomous build pipelines.

### Key ADRs:
*   **ADR-001: Agentic Build Engine Upgrade & Tool-Calling Loop** (Status: Implemented / Approved)
    *   Transitioned the legacy rigid linear pipeline into an interactive, multi-turn tool-calling LLM loop (Gemini, Ollama, OpenAI-compat) executing directly within project target folders.
*   **ADR-002: Dynamic Multi-Project Bridge & Settings Architecture** (Status: Implemented / Approved)
    *   Replaced hardcoded relative steps with global settings path resolution in the UI API layer. The active project's path is dynamically looked up via `~/.factory/projects.json`.
*   **ADR-003: High-Fidelity & Accessible UI Design System** (Status: Implemented / Approved)
    *   Redesigned the entire dashboard interface to support highly responsive layouts, sleek HSL-tailored dark modes, unified settings active integration models, and WCAG-compliant high-contrast colors (e.g. indigo visual action gates).

### Critical Conventions & Patterns:
*   **Spec Naming Convention**: The canonical planning specification file is **`scaffold.yaml`**. Legacy references to `app.yaml` have been globally refactored to `scaffold.yaml` across the engine, UI, skills, and agent configs to distinguish planning specs from build artifacts.
*   **CLI Delegation Workflow**: The engine supports `delegate_to_cli` routing to the `agy` agent for execution in target CWDs. Delegation resolves with delivery states (e.g., `DELIVERY COMPLETE`) and enables agents to inspect project structure (`package.json`, `tsconfig.json`) autonomously.
*   **Board State Logic**: Unsynchronized stories automatically route to the **Backlog**. The "Issues" column has been deprecated; mobile carousel indicators dynamically adjust column counts based on story presence.

---

## 2. Chronology of Major Milestones & What Worked

*   **Milestone 1: Next.js 15 UI Redesign & Active Integration Views**
    *   Replaced default Tailwind forms with modal-driven settings active integration views, unified preferences lists, and responsive grid layouts.
*   **Milestone 2: Spec Viewer & YAML Editor Restore**
    *   Restored the interactive specification YAML viewer and editor in the stories sliding details sheet. Solved empty detail drawer states by correctly deriving target types.
*   **Milestone 3: Daemon Process Controller Integration**
    *   Implemented background daemon starts, stops, restarts, and PID status monitoring directly in the Next.js UI using SSE streams for real-time validation logging.
*   **Milestone 4: Board Logic Refinement & Mobile Adaptation**
    *   Enforced strict state routing: unsynced stories fall to Backlog. Removed redundant "Issues" column. Updated mobile carousel dot indicators to reflect dynamic column counts.
*   **Milestone 5: Skill Simplification & Context Scanning**
    *   Simplified `spec-bootstrap` skill to flat story structure (eliminated epics/dependsOn complexity). Introduced `app-context` skill for autonomous scanning of existing project structures.
*   **Milestone 6: Global Spec Refactor (`app.yaml` → `scaffold.yaml`)**
    *   Executed comprehensive rename of `app.yaml` to `scaffold.yaml` across `engine/rollup.ts`, `cli.ts`, UI API routes, skill definitions, and `AGENTS.md`. This standardizes the mental model for planning vs. artifact generation.
*   **Milestone 7: CLI Delegation Validation**
    *   Validated `delegate_to_cli` mechanism via `test-pi` runs. Confirmed `agy` agent can receive delegation, inspect target directories, and report delivery completion.

---

## 3. Failure Post-Mortems & Anti-Patterns ("What Didn't Work")

### 1. Hardcoded Working Directory Steps
*   **Symptom**: `/api/knowledge` returned an empty response, failing to display ADRs or heartbeats on `http://localhost:4090/#knowledge`.
*   **Root Cause**: The API route resolved relative paths (`../../.factory`) from `process.cwd()`. In Next.js dev execution, this resolved to `/Users/pretheesh/Projects/`, which lacks any `.factory` configuration.
*   **Remediation**: Transitioned all path lookups to read dynamically from the global `projects.json` file in the home directory (`~/.factory/projects.json`), mapping project ID keys directly to their actual paths.

### 2. TypeScript Incremental Build Cache (`tsconfig.tsbuildinfo`) Out-of-Sync
*   **Symptom**: Running `npx tsc --noEmit` locally succeeded, but running it in the UI subdirectory produced false type errors claiming state hooks (`stats`, `setStats`) were missing, even though they were present and passed ESLint.
*   **Root Cause**: TypeScript incremental compilation (`"incremental": true` in `tsconfig.json`) was using stale cached data inside `tsconfig.tsbuildinfo` that did not reflect recent layout modifications.
*   **Remediation**: Cleared `tsconfig.tsbuildinfo` and re-ran the compilation check fresh. Stale incremental compiler caches should always be removed when debugging ghost type compilation errors.

### 3. High-Contrast Accessibility (WCAG Compliance) Failures
*   **Symptom**: Expert usability audits highlighted "white-on-white" text rendering on the main Build buttons, making the primary execution gates completely unreadable.
*   **Root Cause**: Light-themed component backgrounds layered over white-bordered default text classes.
*   **Remediation**: Upgraded button stylings to high-visibility indigo block colors to resolve readability contrast defects.

### 4. Missing Feature Story YAML Resolution
*   **Symptom**: Build queue failure: `YAML parse error (auto-fix exhausted): Feature story not found: .../dynamic-greeting-display-component.yaml`.
*   **Root Cause**: Queue referenced a story file path that did not exist in the filesystem, or the path resolution logic failed to locate the file relative to the project root.
*   **Remediation**: Validate story file existence and path resolution before enqueuing. Ensure YAML references match the actual filesystem structure; implement pre-flight checks for story paths.

### 5. Ollama Tool Call Subscription & Syntax Errors
*   **Symptom**: 
    *   **403 Error**: `this model requires a subscription, upgrade for access`.
    *   **400 Error**: `Value looks like object, but can't find closing '}' symbol`.
*   **Root Cause**: 
    *   **403**: Selected model in tool call exceeded the free tier or required a specific subscription status on the Ollama instance.
    *   **400**: LLM output truncation or malformed JSON in the tool call response, causing parser failure.
*   **Remediation**: 
    *   Implement model availability checks and fallback logic for subscription-gated models.
    *   Enforce strict JSON schema validation in tool calls; implement retry mechanisms with truncation handling for malformed JSON responses.
