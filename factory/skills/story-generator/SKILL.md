---
name: Story Generator
description: Guides agents to write complete, schema-compliant Factory feature and app stories with user story narratives, exhaustive acceptance criteria, and correct file paths.
---

# Story Generator Skill

## Purpose

Write complete, production-ready **Feature Stories** and **App Stories** in Factory YAML format. Every story must include a user story narrative, exhaustive developer-facing acceptance criteria, module breakdown, and dependencies. The output file must be saved to the correct path and be immediately buildable by the Factory engine.

---

## CRITICAL RULES

### 1. File Paths (NON-NEGOTIABLE)
| Story Type | Target Path |
|------------|-------------|
| Feature Story | `.factory/stories/features/<slug>.yaml` |
| App Story | `.factory/stories/apps/<slug>.yaml` |

- **NEVER** create subdirectories inside `features/` or `apps/` (e.g., no `features/auth/`, `features/ui/`)
- **ALWAYS** use `.yaml` extension — never `.md`, never `.json`
- The slug must be kebab-case derived from the feature name

### 2. Status
- New stories start as `status: draft`
- Do NOT set `status: done` or `status: building` on creation

### 3. No Hallucinations
- Base modules, paths, and dependencies on the actual codebase (read `state.yaml` first)
- Do not invent files that don't exist

---

## Step-by-Step Process

### Step 1 — Read Context First
Before writing any story, always read:
```bash
cat .factory/logs/state.yaml      # existing file structure and detected stack
cat .factory/scaffold.yaml        # existing epics and story map
```

### Step 2 — Clarify the User Requirement
If the requirement is ambiguous, extract:
- **Who** is the user? (role)
- **What** do they want to do?
- **Why** (the business value)?
- **What are the edge cases and failure modes?**

### Step 3 — Write the Story File

Save to `.factory/stories/features/<slug>.yaml` using this schema:

```yaml
# ─── Feature Story Schema ─────────────────────────────────
feature:
  name: "Human-readable feature name"
  slug: "kebab-case-slug"

target:
  app: "your-app-name"           # matches scaffold.yaml app name

phase: 1                          # epic order (1 = first)
dependsOn: []                     # list of slugs this story depends on

# ─── User Story ───────────────────────────────────────────
userStory:
  asA: "authenticated user"
  iWantTo: "create and manage recurring savings goals"
  soThat: "I can automatically track progress toward financial milestones"

description: |
  A rich, developer-ready description of what this feature does,
  how it integrates with existing systems, and what the expected
  end state looks like. Minimum 2–3 sentences.

# ─── Acceptance Criteria (5–8 items, testable) ────────────
acceptanceCriteria:
  - "Given a logged-in user, when they create a goal with a name, target amount, and deadline, then it is persisted to the database and appears in their goals list within 500ms"
  - "Given an invalid target amount (negative or zero), when the user submits the form, then an inline validation error is shown and no API call is made"
  - "Given an existing goal, when the user updates the target amount, then the progress percentage recalculates immediately in the UI without a full page reload"
  - "Given a goal with 100% progress, when rendered in the list, then it shows a 'Completed' badge and moves to the completed section"
  - "Given a mobile viewport (< 768px), when the goals list renders, then all goal cards are full-width and the action buttons remain accessible"
  - "Given a network failure during goal creation, when the API call fails, then a toast notification with a retry option is shown"
  - "Given any goal action (create/update/delete), when it completes, then the scaffold.yaml story status is NOT automatically changed (story status is managed by the agent, not the user)"

# ─── Implementation ───────────────────────────────────────
dependencies:
  - "zod"               # for validation schemas
  - "react-hook-form"   # for form state management

modules:
  - name: "GoalSchema"
    path: "src/lib/schemas/goal.ts"
    description: "Zod validation schema for goal create/update payloads"

  - name: "GoalRepository"
    path: "src/lib/db/goals.ts"
    description: "Drizzle/Prisma data access layer — createGoal, updateGoal, deleteGoal, listGoals"

  - name: "GoalAPI"
    path: "src/app/api/goals/route.ts"
    description: "REST endpoint: GET /api/goals, POST /api/goals"

  - name: "GoalDetailAPI"
    path: "src/app/api/goals/[id]/route.ts"
    description: "REST endpoint: PATCH /api/goals/:id, DELETE /api/goals/:id"

  - name: "GoalsPage"
    path: "src/app/goals/page.tsx"
    description: "Main goals list page with create button and progress cards"

  - name: "GoalCard"
    path: "src/components/goals/GoalCard.tsx"
    description: "Reusable card component showing goal name, progress bar, amount, and deadline"

  - name: "GoalForm"
    path: "src/components/goals/GoalForm.tsx"
    description: "Modal form for creating and editing goals with inline validation"

# ─── Behavior / Edge Cases ────────────────────────────────
behavior:
  - "Duplicate goal names within the same user account are rejected with a 409 response"
  - "Deleted goals are soft-deleted (archived) and excluded from active list queries"
  - "Progress percentage is calculated as (currentAmount / targetAmount) * 100, clamped to 0–100"
  - "All monetary values are stored as integers (cents) in the database to avoid float precision issues"

config: {}
status: draft
```

---

## App Story Schema (for `.factory/stories/apps/<slug>.yaml`)

Use this format for **top-level application** stories (deployment, configuration, core scaffold):

```yaml
metadata:
  name: "App Name"
  slug: "app-slug"
  description: "Brief description of the app"
  icon: "🚀"
  color: "#6366f1"
  status: ready-to-build

deployment:
  port: 3000
  region: us-central1

database:
  collections:
    - users
    - goals
  databaseId: app-slug-db

api:
  resources:
    - name: Goal
      collection: goals
      fields:
        name:
          type: string
          required: true
        targetAmount:
          type: number
          required: true
        currentAmount:
          type: number
          default: 0
        deadline:
          type: date
        status:
          type: string
          default: active

status: draft
```

---

## Quality Checklist

Before saving the file, verify:
- [ ] `feature.slug` matches the filename (e.g., `slug: goals-management` → `goals-management.yaml`)
- [ ] `userStory` block is present with `asA`, `iWantTo`, `soThat`
- [ ] At least **5 acceptance criteria** using Given/When/Then format
- [ ] At least **3 modules** with real paths from the codebase
- [ ] `status: draft`
- [ ] File saved to `.factory/stories/features/<slug>.yaml` (no subdirectories)
- [ ] No placeholder text like "TODO" or "implement later"
