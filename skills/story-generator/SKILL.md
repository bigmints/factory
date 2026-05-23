---
name: Story Generator
description: Gathers requirements interactively and generates schema-compliant app or feature stories in YAML format
---

# Story Generator Skill

## What This Does

This skill guides an AI agent to gather product requirements from the user and generate complete, valid, schema-compliant **App Stories** and **Feature Stories** in YAML format. It validates the generated stories using the local validator CLI to ensure they are 100% syntactically and structurally correct.

## Steps to Execute

### 1. Requirements Interview
Begin by asking the user a few structured questions to detail their product or feature.

- **For an App Story:**
  - What is the app name, slug, and core purpose?
  - What technical stack (Next.js is default, SQLite/PostgreSQL, TypeScript)?
  - Do they need authentication (Firebase, NextAuth, standard email/password)?
  - What is the data model (tables and fields)?
  - What pages are required (CRUD pages, custom screens, dashboard)?
- **For a Feature Story:**
  - What target app does this feature integrate into?
  - What is the feature's name and slug?
  - Which build phase should this run in (1 = foundation, 2 = core, 3 = polish)?
  - Does it depend on other features (e.g. `auth-system`, `data-models`)?
  - What data collection/model is needed?
  - What pages/screens need to be created?

### 2. Generate Schema-Compliant Story YAML
Construct a YAML file inside the target project bridge at:
- **App Stories:** `.factory/stories/apps/<story-slug>.yaml`
- **Feature Stories:** `.factory/stories/features/<story-slug>.yaml`

Use the precise schemas below:

#### App Story Schema (`.factory/stories/apps/my-scaffold.yaml`)
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

#### Feature Story Schema (`.factory/stories/features/recurring-schedule.yaml`)
```yaml
feature:
  name: "Recurring Schedule"
  slug: "recurring-schedule"
target:
  app: "my_app"
phase: 1                     # 1 = foundation, 2 = core, 3 = polish (lower builds first)
dependsOn: []                # Slugs of other feature stories that must finish first
dependencies:
  - "date-fns"
model:
  collection: "recurringSchedules"
  fields:
    - name: "title"
      type: "string"
      required: true
    - name: "frequency"
      type: "string"
      required: false
      default: "weekly"
pages:
  - slug: "list"
    type: "list"
    title: "Schedules"
  - slug: "new"
    type: "form"
    title: "New Schedule"
  - slug: "detail"
    type: "detail"
    title: "Schedule Detail"
```

### 3. Validate Story File
Run the local CLI validation tool to ensure the generated YAML is schema-compliant:
```bash
# To validate an App Story:
npx tsx engine/cli.ts validate .factory/stories/apps/<story-slug>.yaml

# To validate a Feature Story:
npx tsx engine/cli.ts feature validate .factory/stories/features/<story-slug>.yaml
```

If errors are found, fix them in the YAML file and re-run the validation command until it outputs `✓ Story is valid`.

### 4. Provide CLI Launch Code
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
