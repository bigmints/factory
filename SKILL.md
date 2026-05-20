---
name: Factory
description: Autonomous app scaffolding and feature generation factory
---

# Factory Skill

## What This Does

The Factory generates production-ready Next.js apps and features from YAML stories. It scaffolds, customises, validates, generates integration patches, and produces build reports — all autonomously.

## Commands

### App Generation

```bash
# Full build pipeline (validate → scaffold → customise → patch → report)
npx tsx engine/cli.ts build .factory/stories/apps/<story>.yaml

# Individual steps
npx tsx engine/cli.ts validate .factory/stories/apps/<story>.yaml
```

### Feature Generation

```bash
# Full feature build (validate → scaffold → apply instructions)
npx tsx engine/cli.ts feature build .factory/stories/features/<story>.yaml

# Validate only
npx tsx engine/cli.ts feature validate .factory/stories/features/<story>.yaml
```

### Project Management

```bash
# Connect a repo to the factory
npx tsx engine/cli.ts project add /path/to/repo

# List connected projects
npx tsx engine/cli.ts project list

# Switch active project
npx tsx engine/cli.ts project switch <project-id>

# Initialise .factory bridge in a repo
npx tsx engine/cli.ts init-bridge /path/to/repo
```

### Queue

```bash
npx tsx engine/cli.ts queue list                       # List all queue items (with phase/dep status)
npx tsx engine/cli.ts queue add .factory/stories/features/x.yaml # Add story (auto-detects phase/dependsOn)
npx tsx engine/cli.ts queue start                      # Process all pending items autonomously
npx tsx engine/cli.ts queue stats                      # Show queue statistics
npx tsx engine/cli.ts queue clear                      # Clear completed items
npx tsx engine/cli.ts queue retry <id>                 # Retry a failed item
npx tsx engine/cli.ts queue remove <id>                # Remove an item from queue
npx tsx engine/cli.ts status                           # Show all stories and their status
```

> The queue respects `phase` (ascending order) and `dependsOn` (blocks until deps complete).

## Story Format

### App Story (`.factory/stories/apps/*.yaml`)

```yaml
metadata:
  name: MyApp # Display name
  slug: my_app # Directory/package name
  icon: Briefcase # Lucide icon name

deployment:
  port: 3020
  region: us-central1
  customDomain: myapp.factory.ai

database:
  firestoreId: myapp
  collections: [items, users]

api:
  resources:
    - name: item
      collection: items
      searchFields: [title, description]
      fields:
        title: { type: string, required: true }
        status: { type: string, default: "active" }
```

### Feature Story (`.factory/stories/features/*.yaml`)

```yaml
feature:
  name: Recurring Schedule
  slug: recurring-schedule

target:
  app: my_app

phase: 1 # Build order: 1 = foundation, 2 = core, 3 = polish

dependsOn: [] # Slugs of stories that must complete first
  # e.g. dependsOn: [auth-system, data-models]

model:
  collection: recurringSchedules
  fields:
    - { name: title, type: string, required: true }
    - { name: frequency, type: string, default: "weekly" }

pages:
  - { slug: list, type: list, title: "Schedules" }
  - { slug: new, type: form, title: "New Schedule" }
  - { slug: detail, type: detail, title: "Schedule Detail" }
```

> **`phase`** controls build priority (lower phases build first). **`dependsOn`** is the hard gate — the engine will not dequeue a story until all its dependencies are `completed`.

## Output

All generated files go to `output/<slug>/`:

- App source code (ready to copy into `apps/<slug>/`)
- `patches/` — integration files for the target project
- `patches/APPLY.md` — step-by-step apply guide
- Reports go to `reports/<slug>-<timestamp>.md`.

## UI Dashboard

Start with `./start.sh` → available at `http://localhost:4040`.

Views: Dashboard, Stories (view/edit YAML), Queue, Reports, Knowledge, Projects.
