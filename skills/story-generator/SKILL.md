---
name: Story Generator
description: Gathers requirements interactively and generates schema-compliant app or feature stories in Markdown with YAML frontmatter.
category: general
tags:
  - story
  - generator
  - planning
  - markdown
  - schema
trigger: story|generator|spec|write|scaffold
enabled: true
---

# Story Generator Skill

## Instructions

This skill guides an AI agent to generate complete, valid, schema-compliant **App Stories** and **Feature Stories**. Stories must be written as **Markdown files** (`.md`) containing a YAML frontmatter block that matches the exact schema, followed by a markdown title and body. It validates the generated stories using the local validator CLI to ensure they are 100% syntactically and structurally correct.

### CRITICAL RULES FOR GENERATION

#### 1. Proactive Codebase & Analysis Discovery (No Generic Questions)
- **Do NOT ask the user simple/generic Option A or Option B questions** if the information is already discoverable in the workspace.
- **Always read files first:** Proactively read `package.json`, `tsconfig.json`, `AGENTS.md`, `README.md`, or `.factory/knowledge/Blueprint.md` in the workspace.
- **Blueprint Integrity:** You must ensure the story's `dependencies` and `stack` align exactly with the project's established blueprint.
- If the user asks to "create stories based on current implementation", automatically extract features and use the **`apply_story`** tool to write the files directly.
- **Only ask questions for absolute ambiguities** that cannot be resolved through codebase research.

#### 2. Exhaustive Product & Architectural Requirements
- Descriptions and feature details must be rich, precise, and developer-ready.
- Specify the exact modules, state boundaries, dependencies, and expected behaviors.
- **Story Granularity & Decomposition Limits:** Break large features down. A single feature story should represent no more than ~300-500 lines of code changes. Split massive features (e.g., "Authentication") into multiple small stories (e.g., "Auth API", "Login UI"). Use the **`decompose_requirements`** tool if available to help brainstorm breakdowns.
- **Draft vs Done:** Newly generated stories MUST be marked with `status: draft`. Only mark `status: done` if the story represents already-implemented legacy code.
- **Dependency Graphing & Phasing Strategy:** You must map out dependencies using the `dependsOn` field so the Factory queue executes them in a valid topological order. Use the `phase` field to sequence major tiers (e.g., Phase 1 = Database/Schema, Phase 2 = Core Logic/API, Phase 3 = UI/UX).

#### 3. High-Fidelity & Comprehensive Acceptance Criteria (5-8 Testable Rules)
Every generated story MUST include a comprehensive list of at least **5 to 8 detailed, developer-facing, and testable acceptance criteria**. These criteria must cover:
1. **Happy Path:** The core functionality (e.g. Docker container spawns and executes).
2. **Error & Edge Cases:** Robust handling (e.g. handles invalid commands, execution timeouts, out-of-memory, and directory boundaries).
3. **Resource & Lifecycle Management:** Automatic cleanup, reaping, or debouncing (e.g. reap sandbox after 15 min of inactivity; debounce LLM calls).
4. **UI/UX States:** Visual representations, overlays, and notifications (e.g. detailed Shadcn-based warning overlay, loading button spinners, empty states).
5. **State/Database Integration:** How it reads, writes, and indexes data (e.g. inserts preference facts into the SQLite `discreteFacts` table).
6. **API/IPC Boundary:** Interfaces, return formats, or background worker communications.

---

### Step-by-Step Execution

#### 1. Proactive Requirement Gathering
Check if the user provided context or files. If they did, read them using filesystem tools. Build a complete understanding of the stack (e.g., Electron, Next.js, tsx, SQLite) and architecture.

#### 2. Generate Schema-Compliant Story Markdown
Construct the story content using the precise schemas below, then save the file.
- **Tool Access:** Use the **`apply_story`** tool (if you are the Factory TPM agent) to save the story. If you are an Antigravity agent, use `write_to_file` to save it to `.factory/stories/apps/<story-slug>.md` or `.factory/stories/features/<story-slug>.md`.

**CRITICAL: Stories must be saved as Markdown files (`.md`), with the YAML schema enclosed in frontmatter (`---`)! Do NOT create raw `.yaml` files.**

##### App Story Schema (`.factory/stories/apps/my-scaffold.md`)
```markdown
---
appName: "My App Name"
description: "Brief detailed description of the app's purpose"
stack:
  framework: "nextjs"
  packageManager: "npm"      # npm, pnpm, yarn, bun
  language: "typescript"      # typescript, javascript
  linter: "eslint"            # eslint, biome, prettier
  testing: "vitest"           # vitest, jest, cypress
  database: "sqlite"          # sqlite, postgresql, firestore
  cloud: "none"               # none, gcp, aws, vercel
frontend:
  ui: "shadcn"                # shadcn, tailwind
  theme: "dark"               # dark, light, system
  icons: "lucide"
  fonts:
    - "Inter"
layout:
  sidebar: true
  topbar: true
  footer: false
auth:
  provider: "firebase"        # firebase, nextauth, custom
  methods:
    email: true
    google: true
  pages:
    login: true
    signup: true
data:
  tables:
    - name: "items"
      fields:
        title:
          type: "string"
          required: true
          description: "Name of the item"
        status:
          type: "string"
          required: false
          default: "active"
pages:
  dashboard:
    - "Overview statistics"
    - "Recent activity"
  crud:
    - table: "items"
  custom:
    - "settings"
deployment:
  port: 3000
  region: "us-central1"
dependencies:
  - "lucide-react"
---

# My App Name
```

##### Feature Story Schema (`.factory/stories/features/recurring-schedule.md`)
```markdown
---
name: "Build recurring schedule feature"  # Must match the name in scaffold.yaml
description: "Implements recurring task schedules with automatic cleanup, database persistence, and a modern schedule builder list view."
status: draft  # draft | in-progress | done
feature:
  name: "Recurring Schedule"
  slug: "recurring-schedule"
target:
  app: "my_app"
phase: 2                     # 1 = foundation, 2 = core, 3 = polish (lower builds first)
dependsOn: []                # Slugs of other feature stories that must finish first
dependencies:
  - "date-fns"
---

# Build recurring schedule feature

## Acceptance Criteria
- **Core**: Schedules are successfully saved to SQLite recurringSchedules table with columns for cronExpression and active.
- **Edge**: Invalid cron expressions reject gracefully with an inline input validation message and do not write to DB.
- **UI**: Responsive list view displays all configured schedules with a toggle button to activate or suspend each.
- **UX**: Interactive form overlay allows selecting predefined frequency (hourly, daily, weekly) or entering custom cron.
- **Cleanup**: Expired schedules are automatically deleted or marked archived by a daily cron worker script.
- **API**: IPC channel allows the main process to fetch all active schedules on startup.
```

#### 3. Validate Story File (Tool Access)
**CRITICAL**: You must actively run the CLI validation tool using your terminal/command tools (e.g. `run_command` in Antigravity) to ensure the generated Markdown is schema-compliant. *(If you are the Factory TPM, generating via `apply_story` handles structural validation automatically, but you should still double check if possible).*

```bash
# To validate an App Story:
npx tsx engine/cli.ts validate .factory/stories/apps/<story-slug>.md

# To validate a Feature Story:
npx tsx engine/cli.ts feature validate .factory/stories/features/<story-slug>.md
```

If errors are found in the tool output, modify the file and re-run the validation command until it outputs `✓ Story is valid` or `✓ All checks passed!`. Do not stop until validation is successful.

#### 4. Post-Completion Activities (Knowledge & Chronicle Updates)
Once the stories have been generated and validated, you must perform these cleanup tasks using your tools:
1. **Architecture Decision Records (ADRs)**: If the generated stories introduce a significant technical design choice (e.g., new state management, IPC pattern, database model), use the **`add_adr_decision`** tool to record this decision before concluding.
2. **Update Knowledge & Chronicles**: If you are the Factory TPM agent, you MUST run the **`build_knowledge`** tool to automatically distill logs and ADRs into `Blueprint.md`, `knowledge.md`, and `chronicle.md`. If you are an Antigravity agent without that tool, manually append an entry to `.factory/knowledge/chronicle.md` and update `.factory/knowledge/Blueprint.md` using file writing tools.

#### 5. Provide CLI Launch Code
Inform the user how they can run the Factory build engine on the story:
- **For an App Story:**
  ```bash
  npx tsx engine/cli.ts build .factory/stories/apps/<story-slug>.md
  ```
- **For a Feature Story:**
  ```bash
  npx tsx engine/cli.ts feature build .factory/stories/features/<story-slug>.md
  ```
- **Using Queue scheduling (recommended for multiple dependencies):**
  ```bash
  npx tsx engine/cli.ts queue add .factory/stories/features/<story-slug>.md
  npx tsx engine/cli.ts queue start
  ```
