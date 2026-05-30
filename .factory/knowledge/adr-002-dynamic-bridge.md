# ADR-002: Dynamic Multi-Project Bridge & Settings Architecture

* **Status**: Implemented / Approved
* **Date**: 2026-05-30
* **Authors**: Antigravity, Factory Core Engineering Team
* **Scope**: UI API Layer, Project Path Resolution, Settings Integration

---

## Context & Problem Statement

Historically, UI API endpoints (such as `/api/knowledge`) resolved target project paths using hardcoded relative directory lookups relative to the Next.js `process.cwd()` (e.g. `path.resolve(process.cwd(), '../..')`). 

This rigid lookup pattern caused major system failures:
1. **Broken Multi-Project Support**: The dashboard could only display context for the root folder where it was started, preventing users from switching active projects dynamically.
2. **Path Out-of-Sync**: Next.js hot reload and dev environments started in different subfolders, leading to relative step overs (such as searching `/Users/pretheesh/Projects` instead of `/Users/pretheesh/Projects/factory`), resulting in completely unpopulated dashboard views.

---

## Decision & Approach

We decided to implement a centralized, dynamic **Multi-Project Bridge & Settings** resolution pattern across the UI API layer.

### 1. Unified Project Lookup via Global State
Centralized project configuration and tracking to `~/.factory/projects.json`. All API routes read the configured `activeProject` and resolve its exact absolute path from the `projects` list on disk.

### 2. Standardized Path Candidates
For all metadata file gathering, API endpoints now check multiple candidate path variants to support various engine storage schemas (YAML, JSON, and TOON formats) located under either `.factory/logs/` or `.factory/context/`:
* **State / Context**: Checks `state.yaml`, `context.yaml`, `state.toon`, `context.toon`.
* **Heartbeat**: Checks `heartbeat.yaml`, `heartbeat.toon` under `logs/`, `blueprint/`, or `context/`.
* **Worklogs**: Checks `worklog.yaml` and `worklog.toon` under `logs/` and `context/`.

### 3. Dynamic Knowledge Auto-Discovery
Updated the `gatherKnowledgeFiles` engine utility to dynamically scan `.factory/knowledge/` for any custom decisions, post-mortems, or chronicles, auto-injecting them into prompts without requiring manual manifest listing in `factory.yaml`.

---

## Consequences

* **Correct Multi-Project Support**: Users can switch projects dynamically inside the dashboard, and all routes immediately reload the correct context.
* **Resilient Data Resolution**: Even if different versions of agents write to `.factory/logs/` or `.factory/context/`, the system finds and populates the data successfully.
* **Type Safety & Build Integration**: All path utilities compile successfully under strict TypeScript and ESLint checking.
