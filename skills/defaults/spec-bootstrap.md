---
name: Spec Bootstrap
description: Interactively create a complete Factory spec suite for a new project — one scaffold.yaml with features and stories containing exhaustive developer-facing acceptance criteria.
category: general
tags:
  - spec
  - bootstrap
  - scaffold
  - planning
  - factory
trigger: spec|bootstrap|scaffold|init-bridge
enabled: true
---

## Instructions

You are helping the user create specs for their project so the Factory build engine can start immediately.

Factory reads **one file**: `.factory/scaffold.yaml`. Everything — features, stories, progress — lives there or is referenced from it. Your job is to produce that file plus the individual story YAML files it references.

> **Bootstrap rule**: Every new project MUST have a `⚙️ Scaffold & Foundation` epic as the **first** feature (priority 0, scaffold: true). It contains one AppStory at `.factory/stories/apps/<app-name>.yaml`. Feature stories cannot build until this AppStory completes and `project.bootstrapped: true` is written to `factory.yaml`.

---

### CRITICAL RULES FOR BOOTSTRAPPING

#### 1. Proactive Codebase Discovery (No Trivial Questions)
- **Always read the existing codebase first** before asking the user questions. Scan the repository for `package.json`, `tsconfig.json`, `AGENTS.md`, or `README.md`.
- Auto-detect the technical stack (framework, language, package manager, and database) from the files. Do not ask the user for information you can easily discover.
- If the project already has source files, construct the spec suite to reflect the existing state, and automatically mark the bootstrap/scaffold story `status` as `done`.

#### 2. High-Fidelity & Comprehensive Acceptance Criteria (5-8 Testable Rules per Story)
Every single story generated MUST include a comprehensive list of at least **5 to 8 detailed, developer-facing, and testable acceptance criteria**. These criteria must cover:
1. **Happy Path:** The core functionality (e.g., login route redirects).
2. **Error & Edge Cases:** Robust inputs/outputs handling.
3. **Resource & Lifecycle Management:** Debouncing, cleanup, or limits.
4. **UI/UX States:** Complete visual rules, empty states, and overlays.
5. **State/Database Integration:** Persistent structures, schemas, and queries.

---

### Step 1 — Auto-Detect & Gather Context

Proactively read files in the target project. Only ask questions for product decisions or absolute gaps:
1. **What is the product purpose?** (if not clear from README)
2. **What are the main feature areas (Epics)?** (define 4-8 logical components, e.g., Auth, Sandbox, Memory, UI)
3. **For each epic, what are the individual stories?**

---

### Step 2 — Show a plan, get confirmation

Before writing files, present a clear structural layout of the features and stories to be created and ask for quick confirmation.

---

### Step 3 — Write `.factory/scaffold.yaml`

This is the **only** file the engine reads for roadmap state. Write it exactly like this:

```yaml
name: "<app-name>"
description: "<one paragraph description>"
version: 1.0.0
status: draft
progressPercent: 0

stack:
  framework: <framework>        # next.js | remix | vite | node | astro | electron
  language: <language>          # typescript | javascript
  packageManager: <pm>          # npm | pnpm | yarn | bun
  styling: <styling>            # tailwind | vanilla-css | shadcn/ui
  database: <database>          # supabase | postgres | sqlite | none
  cloud: <cloud>                # vercel | gcp | aws | none

features:
  # ─── REQUIRED: Scaffold Epic ─── always first, always priority 0 ──────────
  - name: "⚙️ Scaffold & Foundation"
    scaffold: true          # marks this as the bootstrap epic
    priority: 0             # always first — the engine enforces this
    status: pending
    progressPercent: 0
    description: "Creates the project structure, installs core dependencies, sets up the design system. Must complete before any feature story can queue."
    stories:
      - name: "Scaffold <app-name> <framework> project"
        file: .factory/stories/apps/<app-name>.yaml
        status: draft
        progressPercent: 0
        tasks: []

  # ─── Feature Epics ─── unlocked after scaffold completes ────────────────
  - name: "<Feature Name>"
    status: draft
    progressPercent: 0
    stories:
      - name: "<Story title>"
        file: .factory/stories/features/<story-slug>.yaml
        status: draft
        progressPercent: 0
        tasks: []
```

**Rules:**
- `name` at the top level is the app slug — lowercase, hyphens, no spaces.
- `features` MUST start with the `⚙️ Scaffold & Foundation` epic — **do not skip this**.
- The scaffold epic story file goes in `.factory/stories/apps/` — NOT in `features/`.
- Feature stories go in `.factory/stories/features/`.
- `status` is always `draft` (or `done` if already completed).
- `tasks: []` is required on every story.

---

### Step 4 — Write individual story YAML files

For each story, create `.factory/stories/features/<story-slug>.yaml` (or `.factory/stories/apps/<app-name>.yaml` for the bootstrap story).

```yaml
name: "<Story title — must exactly match scaffold.yaml>"
description: "<What this story builds, 1–3 sentences>"
status: draft

# Build spec — required for the engine to run this story
feature:
  name: "<Feature name from scaffold.yaml>"
  slug: "<kebab-case-slug-of-feature-name>"

target:
  app: "<app name — matches scaffold.yaml name field>"

stack:
  framework: <framework>
  language: <language>
  packageManager: <pm>

# Optional: npm packages this story needs installed
dependencies: []

acceptance_criteria:
  - "Happy Path: [Detailed testable criteria]"
  - "Edge Case: [Detailed error handling, validation, boundary behavior]"
  - "UI/UX: [Visual requirements, loading/success/error overlays, responsiveness]"
  - "State: [DB schemas, table updates, transaction boundaries, index creations]"
  - "Resource: [Reaping, cleanups, polling timeouts, CPU limits]"
```

**Rules:**
- `name` must exactly match the story `name` in `scaffold.yaml`.
- `feature.name` must match the parent feature name in `scaffold.yaml`.
- `feature.slug` is kebab-case of the feature name.
- `target.app` is the app slug from `scaffold.yaml`'s root `name` field.
- Include **5 to 8** detailed, present-tense, testable acceptance criteria.
- Wrap values in single quotes if they contain double quotes.

---

### Step 5 — Write `.factory/factory.yaml` if it doesn't exist

```yaml
version: 1

project:
  name: "<app-name>"
  bootstrapped: false   # Set to true manually for EXISTING projects being connected.
  description: "<short description>"

stack:
  framework: <framework>
  language: typescript
  packageManager: <pm>

conventions:
  - "Use strict TypeScript typings"
  - "Write unit tests for complex business utilities"

agentic:
  logs_dir: .factory/logs
  knowledge_dir: .factory/knowledge
```

---

### Step 6 — Validate and Summarise

Run `npx tsx engine/cli.ts validate .factory/stories/apps/<app-name>.yaml` and feature validations. Present a clear map of what was successfully generated to the user.
