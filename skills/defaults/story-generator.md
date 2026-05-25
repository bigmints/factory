---
name: Story Generator
description: Gathers requirements interactively and generates schema-compliant app or feature stories in YAML format with exhaustive developer-facing acceptance criteria.
category: general
tags:
  - story
  - generator
  - planning
  - yaml
  - schema
trigger: story|generator|spec|write|scaffold
enabled: true
---

## Instructions

This skill guides an AI agent to generate complete, valid, schema-compliant **App Stories** and **Feature Stories** in YAML format. It validates the generated stories using the local validator CLI to ensure they are 100% syntactically and structurally correct.

### CRITICAL RULES FOR GENERATION

#### 1. Proactive Codebase & Analysis Discovery (No Generic Questions)
- **Do NOT ask the user simple/generic Option A or Option B questions** if the information is already discoverable in the workspace.
- **Always read files first:** Proactively read `package.json`, `tsconfig.json`, `AGENTS.md`, `README.md`, or previous analysis reports (e.g., comparison files like `analysis_results.md`) in the workspace.
- If the user asks to "create stories based on current implementation/analysis", the agent must automatically extract all features, target apps, stacks, and directories, and write the YAML files directly.
- **Only ask questions for absolute ambiguities** that cannot be resolved through codebase research.

#### 2. Exhaustive Product & Architectural Requirements
- Descriptions and feature details must be rich, precise, and developer-ready.
- Specify the exact modules, state boundaries, dependencies, and expected behaviors.
- For existing codebases/bootstraps, automatically mark the story `status` as `done` in the YAML if it represents already-implemented code.

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

#### 2. Generate Schema-Compliant Story YAML
Construct a YAML file inside the target project bridge at:
- **App Stories:** `.factory/stories/apps/<story-slug>.yaml`
- **Feature Stories:** `.factory/stories/features/<story-slug>.yaml`

Use the precise schemas below:

##### App Story Schema (`.factory/stories/apps/my-scaffold.yaml`)
```yaml
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
```

##### Feature Story Schema (`.factory/stories/features/recurring-schedule.yaml`)
```yaml
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
acceptance_criteria:
  - "Core: Schedules are successfully saved to SQLite recurringSchedules table with columns for cronExpression and active"
  - "Edge: Invalid cron expressions reject gracefully with an inline input validation message and do not write to DB"
  - "UI: Responsive list view displays all configured schedules with a toggle button to activate or suspend each"
  - "UX: Interactive form overlay allows selecting predefined frequency (hourly, daily, weekly) or entering custom cron"
  - "Cleanup: Expired schedules are automatically deleted or marked archived by a daily cron worker script"
  - "API: IPC channel allows the main process to fetch all active schedules on startup"
```

#### 3. Validate Story File
Run the local CLI validation tool to ensure the generated YAML is schema-compliant:
```bash
# To validate an App Story:
npx tsx engine/cli.ts validate .factory/stories/apps/<story-slug>.yaml

# To validate a Feature Story:
npx tsx engine/cli.ts feature validate .factory/stories/features/<story-slug>.yaml
```

If errors are found, fix them in the YAML file and re-run the validation command until it outputs `✓ Story is valid` or `✓ All checks passed!`.

#### 4. Provide CLI Launch Code
Inform the user how they can run the Factory build engine on the story:
- **For an App Story:**
  ```bash
  npx tsx engine/cli.ts build .factory/stories/apps/<story-slug>.yaml
  ```
- **For a Feature Story:**
  ```bash
  npx tsx engine/cli.ts feature build .factory/stories/features/<story-slug>.yaml
  ```
- **Using Queue scheduling (recommended for multiple dependencies):**
  ```bash
  npx tsx engine/cli.ts queue add .factory/stories/features/<story-slug>.yaml
  npx tsx engine/cli.ts queue start
  ```
