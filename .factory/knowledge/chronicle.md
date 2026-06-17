# REPOSITORY ARCHITECTURAL CHRONICLE

This chronicle is a consolidated semantic history of the Factory build engine. It acts as a memory bridge for AI coding agents to preserve key context, stack choices, major milestones, and post-mortems of previous failures and learnings.

---

## 1. Architectural Context & Key ADR Highlights

The Factory platform orchestrates multi-agent tasks, spec validation, and autonomous build pipelines.

### Key ADRs:
*   **ADR-001: Agentic Build Engine Upgrade & Tool-Calling Loop** (Status: Implemented / Approved)
    *   Transitioned the legacy rigid linear pipeline into an interactive, multi-turn tool-calling LLM loop (Gemini, Ollama, OpenAI-compat) executing directly within project target folders. Eliminates blind execution and reduces remediation overhead by granting the generator real-time filesystem/compiler access.
*   **ADR-002: Dynamic Multi-Project Bridge & Settings Architecture** (Status: Implemented / Approved)
    *   Replaced hardcoded relative steps with global settings path resolution in the UI API layer. The active project's path is dynamically looked up via `~/.factory/projects.json`, resolving Next.js `process.cwd()` desync issues.
*   **ADR-003: High-Fidelity & Accessible UI Design System** (Status: Implemented / Approved)
    *   Redesigned the entire dashboard interface to support highly responsive layouts, sleek HSL-tailored dark modes, unified settings active integration models, and WCAG-compliant high-contrast colors (e.g. indigo visual action gates).
*   **ADR-004: Spec Architecture & Naming Convention** (Status: Implemented / Approved)
    *   Renamed `app.yaml` → `scaffold.yaml` across engine, UI, and skills to accurately reflect its role as a planning/scaffolding specification rather than a build artifact.
*   **ADR-005: CLI Agent Delegation Workflow** (Status: Validated)
    *   Confirmed `delegate_to_cli → agy` pattern for autonomous TS project validation: directory inspection, `npm run build`, execution, ESLint, and state reporting.

---

## 2. Chronology of Major Milestones & What Worked

*   **Milestone 1: Next.js 15 UI Redesign & Active Integration Views**
    *   Replaced default Tailwind forms with modal-driven settings active integration views, unified preferences lists, and responsive grid layouts.
*   **Milestone 2: Spec Viewer & YAML Editor Restore**
    *   Restored the interactive specification YAML viewer and editor in the stories sliding details sheet. Solved empty detail drawer states by correctly deriving target types.
*   **Milestone 3: Daemon Process Controller Integration**
    *   Implemented background daemon starts, stops, restarts, and PID status monitoring directly in the Next.js UI using SSE streams for real-time validation logging.
*   **Milestone 4: Board State & Layout Optimization**
    *   Routed unsynced stories to Backlog, removed redundant Issues column, and synchronized mobile carousel dot indicators with dynamic column counts.
*   **Milestone 5: Skill & Spec Refactor**
    *   Flattened `spec-bootstrap` skill (removed epics/dependsOn), added `app-context` skill for project scanning, and executed global `app.yaml` → `scaffold.yaml` rename across engine, UI, and skills.
*   **Milestone 6: CLI Delegation & Validation Pipeline**
    *   Validated `delegate_to_cli → agy` workflow for TS projects: successfully handles directory state checks, `package.json`/`tsconfig` inspection, `npm run build`, execution, ESLint, and delivery reporting.

---

## 3. Failure Post-Mortems & Anti-Patterns ("What Didn't Work" and how it was resolved)

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

### 4. LLM Tool-Calling & API Quota Failures (Ollama 403/400)
*   **Symptom**: Queue jobs (`q_form_validation`) failed with `Ollama tool call error (403): subscription required` and `error (400): Value looks like object, but can't find closing '}' symbol`.
*   **Root Cause**: LLM output contained malformed JSON objects missing closing braces, and the selected Ollama model tier hit rate-limit/subscription gates during high-frequency tool calls.
*   **Remediation**: Implemented strict JSON schema validation pre-tool-call, added graceful 403 fallback routing to alternative models, and enforced brace-pairing checks in the LLM prompt template.

### 5. YAML Story Resolution & Path Mismatch
*   **Symptom**: `YAML parse error (auto-fix exhausted): Feature story not found: /Users/pretheesh/Projects/factory/features/dynamic-greeting-display-component.yaml`.
*   **Root Cause**: Queue engine attempted to resolve a feature story path that was referenced in the spec but not yet materialized on disk, causing the auto-fix loop to exhaust without a fallback.
*   **Remediation**: Added pre-queue path existence validation, implemented lazy file creation for missing story slugs, and capped auto-fix retries to prevent infinite loop exhaustion.
