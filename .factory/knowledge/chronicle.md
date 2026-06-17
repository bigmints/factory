# REPOSITORY ARCHITECTURAL CHRONICLE

## 1. Architectural Context & Key ADR Highlights

* **ADR-001: Agentic Build Engine & Tool-Calling Loop** | Transitioned from rigid linear pipelines to interactive, multi-turn LLM tool-calling (Gemini/Ollama/OpenAI) executing directly in target folders to eliminate blind execution.
* **ADR-002: Dynamic Multi-Project Bridge** | Replaced hardcoded `process.cwd()` lookups with global `~/.factory/projects.json` resolution for dynamic UI API path mapping and cross-project context switching.
* **ADR-003: High-Fidelity & Accessible UI** | Implemented responsive HSL-tailored dark modes, unified settings integration, and WCAG-compliant high-contrast indigo action gates to resolve readability defects.
* **ADR-004: Spec Architecture & Naming Convention** | Standardized `app.yaml` → `scaffold.yaml` across engine, UI, and skills to reflect planning/scaffolding semantics over build artifacts.
* **ADR-005: CLI Agent Delegation Workflow** | Validated `delegate_to_cli → agy` pattern for autonomous TS project validation (dir inspection, `npm run build`, ESLint, state reporting).
* **ADR-006: Multi-Agent CLI Routing (`agy` & `pi`)** | Extended delegation to support `pi` agent sessions with MCP extensions (`pi-mcp-adapter`, `headroom`) and skill context loading (`toon-context`), enabling parallel validation and context-aware execution.

## 2. Chronology of Major Milestones & What Worked

* **M1: Next.js 15 UI Redesign** | Replaced default Tailwind forms with modal-driven settings, unified preferences, and responsive grid layouts.
* **M2: Spec Viewer & YAML Editor Restore** | Restored interactive YAML viewer/editor in sliding details sheet; resolved empty drawer states via dynamic target type derivation.
* **M3: Daemon Process Controller** | Implemented background daemon lifecycle management (start/stop/restart/PID monitoring) via Next.js SSE streams for real-time validation logging.
* **M4: Board State & Layout Optimization** | Routed unsynced stories to Backlog, deprecated redundant Issues column, and synchronized mobile carousel indicators with dynamic column counts.
* **M5: Skill & Spec Refactor** | Flattened `spec-bootstrap` (removed epics/dependsOn), introduced `app-context` for project scanning, and executed global `app.yaml` → `scaffold.yaml` migration.
* **M6: CLI Delegation & Validation Pipeline** | Validated `delegate_to_cli → agy` workflow for TS projects: successfully handles directory state checks, `package.json`/`tsconfig` inspection, `npm run build`, execution, ESLint, and delivery reporting.
* **M7: Multi-Agent CLI Routing** | Extended delegation to `pi` agent sessions, confirming successful initialization with MCP adapters and skill context loading.
* **M8: Global Spec Standardization** | Completed cross-repo `scaffold.yaml` adoption across engine, UI, and skills, eliminating semantic ambiguity in planning artifacts.
* **M9: Board Layout & Mobile Sync** | Removed standalone 'Uncategorized' section, enforced 4-column grid when Issues present, auto-included new columns in mobile carousel dot indicators.
* **M10: Spec & Skill Architecture Overhaul** | Simplified `spec-bootstrap` to flat story structure, deployed `app-context` skill for project scanning, standardized `scaffold.yaml` nomenclature across all engine/UI/skill layers.
* **M11: Multi-Agent CLI Validation Pipeline** | Confirmed `agy` agent successfully builds/lints TS projects; `pi` agent reliably initializes sessions with MCP extensions (`pi-mcp-adapter`, `headroom`) and loads `toon-context` skills for parallel execution.

## 3. Failure Post-Mortems & Anti-Patterns ("What Didn't Work" and how it was resolved)

### 1. Hardcoded Working Directory Resolution
* **Symptom**: `/api/knowledge` returned empty responses; ADRs/heartbeats failed to render on `localhost:4090`.
* **Root Cause**: API routes used relative paths (`../../.factory`) from `process.cwd()`, resolving incorrectly in Next.js dev environments.
* **Fix**: Migrated to dynamic path resolution via `~/.factory/projects.json`, mapping project IDs to absolute disk paths.

### 2. TypeScript Incremental Cache Desync
* **Symptom**: `npx tsc --noEmit` passed locally but failed in UI subdirectory with phantom missing hook errors (`stats`, `setStats`).
* **Root Cause**: Stale `tsconfig.tsbuildinfo` cache retained outdated type mappings after recent layout modifications.
* **Fix**: Implemented cache purge (`rm tsconfig.tsbuildinfo`) as a standard debugging step for ghost type errors; enforced fresh compilation checks.

### 3. WCAG High-Contrast Accessibility Defects
* **Symptom**: "White-on-white" text rendering on primary Build buttons, causing critical readability failures.
* **Root Cause**: Light-themed component backgrounds layered over default white text classes without explicit contrast overrides.
* **Fix**: Enforced high-visibility indigo block colors for primary action gates; standardized WCAG AA contrast ratios across the design system.

### 4. LLM Tool-Calling & API Quota Failures (Ollama 403/400)
* **Symptom**: Queue jobs failed with `403: subscription required` and `400: missing closing '}' symbol`.
* **Root Cause**: Malformed JSON outputs from LLM tool calls; selected Ollama model tiers hit rate-limit/subscription gates during high-frequency polling.
* **Fix**: Implemented strict JSON schema validation pre-tool-call, added graceful 403 fallback routing to alternative models, and enforced brace-pairing checks in prompt templates.

### 5. YAML Story Resolution & Path Mismatch
* **Symptom**: `YAML parse error (auto-fix exhausted): Feature story not found: [.../dynamic-greeting-display-component.yaml]`.
* **Root Cause**: Queue engine referenced unmaterialized feature story paths without fallback logic, causing infinite auto-fix loop exhaustion.
* **Fix**: Added pre-queue path existence validation, implemented lazy file creation for missing slugs, and capped auto-fix retries to prevent loop exhaustion.
