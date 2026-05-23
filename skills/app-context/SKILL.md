---
name: factory-app-context
description: >
  Scans an existing codebase and builds Factory app context — the .factory/scaffold.yaml
  and story files that reflect what is already built and what still needs to be built.
  Run this before queuing any builds on an existing project.
---

# Factory App Context Skill

You are scanning an **existing codebase** to build Factory's app context.
Factory needs to understand what already exists before it can generate anything new — otherwise it duplicates work, uses wrong patterns, or generates conflicting code.

Your job is to produce:
1. `.factory/scaffold.yaml` — features and stories, with existing work marked `done`
2. Individual story YAML files in `.factory/stories/features/` for work that still needs to be built
3. `.factory/factory.yaml` — bridge config if missing

**Do not generate code. Do not modify source files. Only create `.factory/` files.**

---

## Step 1 — Read the project

Read these files if they exist (do not skip any):

```
package.json              # dependencies, scripts, version
tsconfig.json             # compiler options, paths
README.md                 # product description
AGENTS.md                 # existing conventions (if present)
.factory/factory.yaml     # existing bridge config
.factory/scaffold.yaml         # existing spec (if any)
src/ or app/ directory    # file tree — understand routes, components, modules
```

For Next.js: read `src/app/` or `app/` for route structure.
For Node: read `src/` for module structure.
For any project: look at `package.json` `dependencies` to infer what is already installed and working.

Build a mental model of:
- **What is already built** (routes/pages that exist, features that work)
- **What is partially built** (components started but incomplete)
- **What is missing** (features described in README but no code yet)

---

## Step 2 — Detect the stack

Extract from `package.json` and config files:

```yaml
stack:
  framework:      # next.js | remix | vite | node | astro | express
  language:       # typescript | javascript
  packageManager: # npm | pnpm | yarn | bun  (check lockfile: package-lock.json / pnpm-lock.yaml / yarn.lock / bun.lockb)
  styling:        # tailwind | vanilla-css | shadcn/ui | styled-components | none
  database:       # supabase | postgres | sqlite | prisma | drizzle | none
  cloud:          # vercel | gcp | aws | none
  testing:        # vitest | jest | playwright | none
```

---

## Step 3 — Map existing work to features

Group what you find into **4–8 named feature areas** (same as you'd put in scaffold.yaml `features`).
For each feature, assess its completeness:

| Status | Meaning |
|--------|---------|
| `done` | Code exists, appears functional, tests pass or not required |
| `in-progress` | Code started but incomplete or has TODO/FIXME markers |
| `draft` | Planned or stubbed but not implemented |

Examples of feature areas:
- App Shell & Navigation (layout, nav, routing, theming)
- Auth (login, session, protected routes)
- Dashboard (overview page, metrics)
- [Domain feature] (your app's core feature)
- Settings (config UI)
- API Layer (backend routes, data fetching)

---

## Step 4 — Show your findings, get confirmation

Present a summary before writing anything:

```
I scanned the codebase. Here's what I found:

Stack: Next.js 14 · TypeScript · pnpm · Tailwind · Supabase

Feature: App Shell & Navigation       → done
  ✓ Layout with sidebar and header exists (src/components/layout/)
  ✓ Bottom nav for mobile exists
  ✓ Dark/light theme toggle working

Feature: Auth                          → done
  ✓ Login page at /auth/login
  ✓ Supabase session handling in middleware.ts
  ✗ "Forgot password" page missing (mentioned in README)

Feature: Dashboard                     → in-progress
  ✓ Dashboard route exists (/app/dashboard)
  ~ Metrics cards stubbed with hardcoded data (TODO in dashboard.tsx:42)
  ✗ Real-time updates not connected

Feature: Invoicing                     → draft
  ✗ No code found — only mentioned in README

Does this look right? Any corrections before I write the spec files?
```

Wait for confirmation before writing files.

---

## Step 5 — Write `.factory/scaffold.yaml`

```yaml
name: "<app-name>"                    # lowercase-hyphen slug
description: "<from README or inferred>"
version: 1.0.0
status: in-progress                   # reflects that work is already underway
progressPercent: 0                    # will be calculated on sync

stack:
  framework: <detected>
  language: <detected>
  packageManager: <detected>
  styling: <detected>
  database: <detected>
  cloud: <detected>

features:
  # ── EXISTING / DONE FEATURES ──────────────────────────────────────────────
  - name: "<Feature that is done>"
    status: done
    progressPercent: 100
    stories:
      - name: "<What was built>"
        file: .factory/stories/features/<story-slug>.yaml
        status: done
        progressPercent: 100
        tasks: []

  # ── IN-PROGRESS FEATURES ──────────────────────────────────────────────────
  - name: "<Feature partially done>"
    status: in-progress
    progressPercent: 0
    stories:
      - name: "<Completed part>"
        file: .factory/stories/features/<story-slug>.yaml
        status: done
        progressPercent: 100
        tasks: []
      - name: "<Remaining part>"
        file: .factory/stories/features/<story-slug>.yaml
        status: draft
        progressPercent: 0
        tasks: []

  # ── TODO FEATURES ─────────────────────────────────────────────────────────
  - name: "<Feature not yet started>"
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
- `name` at root = app slug (lowercase-hyphen)
- One story per meaningful unit of work — not too granular, not too coarse
- Existing/done stories still need a story file — use the simplified format below
- `status` values: `done` | `in-progress` | `draft` only — never `todo`, `pending`, `unknown`
- No `dependsOn`, no `phase`, no `milestone`, no `id` fields
- `tasks: []` required on every story

---

## Step 6 — Write story YAML files

**For `done` stories** (what already exists), create a minimal record:

```yaml
name: "<Story title — matches scaffold.yaml exactly>"
description: "<What was built — past tense>"
status: done

notes: |
  Already implemented. Key files:
  - src/components/layout/AppLayout.tsx
  - src/app/(auth)/login/page.tsx
  (Add the actual key files you found)
```

**For `draft` stories** (what still needs to be built), create a full spec:

```yaml
name: "<Story title — matches scaffold.yaml exactly>"
description: "<What needs to be built, 1–3 sentences>"
status: draft

context: |
  Existing codebase uses:
  - <relevant package already installed>
  - <relevant convention to follow>
  - <relevant file to extend or not duplicate>

acceptance_criteria:
  - "<Specific, testable criterion>"
  - "<Another criterion>"
  - "<Another criterion>"
```

The `context:` block is important — it tells the build engine what already exists so it doesn't duplicate or conflict.

---

## Step 7 — Write `.factory/factory.yaml` if missing

```yaml
version: 1
name: "<app-name>"
description: "<short description>"
factory_home: /path/to/factory       # path to Factory install — ask user if unsure
```

---

## Step 8 — Summarise and hand off

```
✅ App context built for <App Name>

.factory/scaffold.yaml
  └── App Shell & Navigation     done       (2 stories)
  └── Auth                       done       (3 stories)
  └── Dashboard                  in-progress (1 done, 2 draft)
  └── Invoicing                  draft      (4 stories)

.factory/stories/features/
  ├── app-shell-layout.yaml          [done]
  ├── auth-login-session.yaml        [done]
  ├── dashboard-real-time.yaml       [draft]
  ├── invoicing-list.yaml            [draft]
  └── ...

The Factory board will show:
  - Done stories in the Completed column
  - Draft stories in the Backlog column

Next: open the Factory dashboard → Plan tab → click "Sync Roadmap"
To build draft stories: drag to "Ready to Build" → click "Build Ready"
```

---

## Minimal working example

**.factory/scaffold.yaml** (for a project with auth done, dashboard in-progress)
```yaml
name: my-saas
description: SaaS platform for managing client projects
version: 1.0.0
status: in-progress
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
    status: done
    progressPercent: 100
    stories:
      - name: Login, signup, and session management
        file: .factory/stories/features/auth-login-session.yaml
        status: done
        progressPercent: 100
        tasks: []

  - name: Dashboard
    status: in-progress
    progressPercent: 0
    stories:
      - name: Dashboard page with static metrics cards
        file: .factory/stories/features/dashboard-static.yaml
        status: done
        progressPercent: 100
        tasks: []
      - name: Connect metrics cards to live Supabase data
        file: .factory/stories/features/dashboard-live-data.yaml
        status: draft
        progressPercent: 0
        tasks: []
```

**.factory/stories/features/auth-login-session.yaml**
```yaml
name: Login, signup, and session management
description: Authentication flow with Supabase Auth — already implemented.
status: done

notes: |
  Already implemented. Key files:
  - src/app/(auth)/login/page.tsx
  - src/app/(auth)/signup/page.tsx
  - src/middleware.ts  (session + route protection)
  - src/lib/supabase/client.ts
```

**.factory/stories/features/dashboard-live-data.yaml**
```yaml
name: Connect metrics cards to live Supabase data
description: Replace hardcoded numbers in the dashboard metrics cards with real queries from Supabase.
status: draft

context: |
  Existing codebase uses:
  - @supabase/supabase-js (already installed)
  - React Query for server state (tanstack/react-query)
  - Metrics card component at src/components/dashboard/MetricsCard.tsx
  Do NOT create a new Supabase client — use src/lib/supabase/client.ts

acceptance_criteria:
  - Metrics cards fetch data from Supabase on page load
  - Loading skeleton shown while data is fetching
  - Error state shown if query fails
  - Data refreshes every 60 seconds automatically
```
