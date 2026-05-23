---
name: factory-spec-bootstrap
description: >
  Interactively create a complete Factory spec suite for a new project —
  one app.yaml with features + inline stories, plus individual story YAML files.
  No dependency maps. No epic hierarchy. Flat, engine-ready structure.
---

# Factory Spec Bootstrap Skill

You are helping the user create specs for their project so the Factory build engine can start immediately.

Factory reads **one file**: `.factory/app.yaml`. Everything — features, stories, progress — lives there or is referenced from it. Your job is to produce that file plus the individual story YAML files it references.

**No epics. No dependency maps. No phase ordering. No dependsOn. Just features → stories.**

---

## Step 1 — Ask only what you need

Ask these questions (batch them to keep it fast):

1. **What does this project do?** (one paragraph)
2. **App name?** (becomes the slug, e.g. `pi-app`)
3. **Tech stack?** — framework, package manager, language, database, cloud
4. **What are the main feature areas?** List 4–8 feature names (e.g. "Chat UI", "Auth", "Settings"). These become features in app.yaml.
5. **For each feature, what are the individual pieces of work (stories)?** 2–6 per feature is ideal.

> If you can read existing files in the project (package.json, AGENTS.md, README), do so first — auto-detect the stack so you don't have to ask.

---

## Step 2 — Show a plan, get confirmation

Before writing any files, show this summary and ask the user to confirm:

```
app.yaml will contain:
  Feature: Chat UI
    - Story: Build message bubble components
    - Story: Implement WebSocket streaming
    - Story: Add auto-scroll behaviour
  Feature: Auth
    - Story: Build login screen
    - Story: Implement session persistence
  ...

Story files will be created in:
  .factory/stories/features/<story-slug>.yaml
```

Adjust based on feedback before writing anything.

---

## Step 3 — Write `.factory/app.yaml`

This is the **only** file the engine reads for roadmap state. Write it exactly like this:

```yaml
name: "<app-name>"
description: "<one paragraph description>"
version: 1.0.0
status: draft
progressPercent: 0

stack:
  framework: <framework>        # next.js | remix | vite | node | astro
  language: <language>          # typescript | javascript
  packageManager: <pm>          # npm | pnpm | yarn | bun
  styling: <styling>            # tailwind | vanilla-css | shadcn/ui
  database: <database>          # supabase | postgres | sqlite | none
  cloud: <cloud>                # vercel | gcp | aws | none

features:
  - name: "<Feature Name>"
    status: draft
    progressPercent: 0
    stories:
      - name: "<Story title>"
        file: .factory/stories/features/<story-slug>.yaml
        status: draft
        progressPercent: 0
        tasks: []

  - name: "<Next Feature>"
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
- `name` at the top level is the app slug — lowercase, hyphens, no spaces
- `features` is a flat list — no nesting, no IDs, no phase numbers, no milestones
- Each feature has a `stories` array — **inline**, not a file reference
- Each story has a `file` pointing to `.factory/stories/features/<story-slug>.yaml`
- `status` is always `draft` to start — never `todo`, `pending`, or `unknown`
- No `dependsOn`, no `phase`, no `milestone`, no `id` fields on features or stories
- `tasks: []` is required on every story even if empty

---

## Step 4 — Write individual story YAML files

For each story create `.factory/stories/features/<story-slug>.yaml`:

```yaml
name: "<Story title — same as in app.yaml>"
description: "<What this story builds, 1–3 sentences>"
status: draft

acceptance_criteria:
  - "<Specific, testable criterion>"
  - "<Another criterion>"
  - "<Another criterion>"
```

**Rules:**
- `name` must exactly match the `name` field in `app.yaml`'s story entry
- `status: draft` always
- Include 3–6 acceptance criteria written as present-tense testable statements
- No tasks, no subtasks, no checklists, no dependencies — keep it minimal
- Filename is lowercase-hyphen slug of the story title

---

## Step 5 — Write `.factory/factory.yaml` if it doesn't exist

```yaml
version: 1
name: "<app-name>"
description: "<short description>"
factory_home: /path/to/factory  # path to Factory install — ask user if unsure
```

---

## Step 6 — Validate and summarise

After writing all files, tell the user:

```
✅ Done. Here's what was created:

.factory/app.yaml
  └── Feature: Chat UI (3 stories)
  └── Feature: Auth (2 stories)
  └── Feature: Settings (2 stories)

.factory/stories/features/
  ├── build-message-bubbles.yaml
  ├── implement-websocket-streaming.yaml
  ├── ...

Next: open the Factory dashboard → Plan tab → click "Sync Roadmap"
Stories will appear on the board grouped by feature.
```

---

## Minimal working example

**.factory/app.yaml**
```yaml
name: task-manager
description: A web app to manage tasks with team collaboration
version: 1.0.0
status: draft
progressPercent: 0

stack:
  framework: next.js
  language: typescript
  packageManager: pnpm
  styling: tailwind
  database: supabase
  cloud: vercel

features:
  - name: Auth
    status: draft
    progressPercent: 0
    stories:
      - name: Build login and signup screens
        file: .factory/stories/features/login-signup-screens.yaml
        status: draft
        progressPercent: 0
        tasks: []
      - name: Implement session persistence with httpOnly cookie
        file: .factory/stories/features/session-persistence.yaml
        status: draft
        progressPercent: 0
        tasks: []

  - name: Task Management
    status: draft
    progressPercent: 0
    stories:
      - name: Build task list with filters and sorting
        file: .factory/stories/features/task-list.yaml
        status: draft
        progressPercent: 0
        tasks: []
      - name: Build task detail and edit form
        file: .factory/stories/features/task-detail-form.yaml
        status: draft
        progressPercent: 0
        tasks: []
```

**.factory/stories/features/login-signup-screens.yaml**
```yaml
name: Build login and signup screens
description: Login and signup UI with form validation, error states, and redirect on success.
status: draft

acceptance_criteria:
  - Login form accepts email and password with inline validation
  - Signup form collects name, email, and password with confirmation
  - Errors display inline beneath each field
  - Successful login redirects to dashboard
  - Loading state shown on submit button during request
```
