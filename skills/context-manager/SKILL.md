---
name: Context Manager
description: Manages the .factory bridge context, automated TOON worklog updates, AGENTS.md rules, and Git post-commit hooks
---

# Context Manager Skill

## What This Does

This skill instructs an AI agent on how to manage and synchronize integration contexts between the **Factory build engine** and target application repositories. It covers initializing the `.factory` bridge in target repos, installing automated git hooks for chronological TOON worklogs, updating the worklog manually, and keeping `AGENTS.md` rules current.

## Core Concepts

### 1. The `.factory` Bridge
Every project connected to the Factory has a `.factory/` directory in its repository root containing:
- `factory.yaml` — Bridge manifest containing the stack, active applications, and configuration of directories.
- `context/` — Holds the dynamic chronological worklog and active contexts in TOON format.
- `stories/` — Contains target application and feature stories (`stories/apps/` and `stories/features/`).
- `knowledge/` — Built histories and architectural summaries generated after successful builds.

### 2. Chronological Worklogs (TOON format)
To prevent context drift and token fatigue, a chronological worklog (`.factory/context/worklog.yaml` in TOON format) tracks key milestones, major updates, and database or API changes. The context gatherer automatically compiles this, giving the LLM precise awareness of past features.

## Step-by-Step Operations

### 1. Initialize a Bridge in a Target Repo
To connect any repository and initialize a `.factory` bridge:
```bash
# Connect the repository to the Factory project manager
npx tsx engine/cli.ts project add /path/to/target-repo

# Initialize the bridge structure inside the target repository
npx tsx engine/cli.ts init-bridge /path/to/target-repo
```
This generates the `.factory/` directory and creates `factory.yaml`.

### 2. Install Automated Git Hooks (Chronological Worklog)
To automate worklog updates, install git post-commit hooks in the target repository. This guarantees that every commit is logged, parsing file changes and commit messages in TOON format without human intervention:
```bash
npx tsx engine/cli.ts hooks install
```
This writes a `.git/hooks/post-commit` script that triggers context updates automatically whenever developers or agents commit code.

### 3. Manually Update Context Worklog
When making direct modifications outside of Git, or to log manual updates, run the context update tool:
```bash
# General syntax: factory context update "<message>"
npx tsx engine/cli.ts context update "feat(database): added migration support for SQLite"
```
This appends the entry to the worklog securely in TOON format.

### 4. Maintain and Update `AGENTS.md`
Every project contains a specialized `AGENTS.md` (or `AGENTS.md` under `.factory/conventions/`) that serves as the "constitution" for AI development in that project.
- **When to read it:** Eagerly read the `AGENTS.md` of any target project before modifying code to align on its guidelines, stack, directory layouts, and rules.
- **When to update it:** When you introduce a major architectural design decision, add a new table/schema, or install new core packages (e.g. Prisma, Firebase-auth), edit `AGENTS.md` to document the new conventions. Keep the guidelines crisp, concise, and structured.

### 5. Context Compilation (Gathering)
Before generating any app or feature, the build pipeline automatically compiles these files via:
```typescript
const context = gatherContext(projectPath, bridgeConfig);
```
This scans tsconfig.json, package.json, TOON worklogs, file structures, and past knowledge files, ensuring the LLM generates 100% complementary and integration-aware code.
