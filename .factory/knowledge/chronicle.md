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

---

## 2. Chronology of Major Milestones & What Worked

*   **Milestone 1: Next.js 15 UI Redesign & Active Integration Views**
    *   Replaced default Tailwind forms with modal-driven settings active integration views, unified preferences lists, and responsive grid layouts.
*   **Milestone 2: Spec Viewer & YAML Editor Restore**
    *   Restored the interactive specification YAML viewer and editor in the stories sliding details sheet. Solved empty detail drawer states by correctly deriving target types.
*   **Milestone 3: Daemon Process Controller Integration**
    *   Implemented background daemon starts, stops, restarts, and PID status monitoring directly in the Next.js UI using SSE streams for real-time validation logging.

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
