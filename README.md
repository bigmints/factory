<p align="center">
  <h1 align="center">🏭 Factory</h1>
  <p align="center">
    <strong>Autonomous TPM-driven build engine — delegate to CLI agents, monitor, ship.</strong>
  </p>
  <p align="center">
    <a href="#quick-start">Quick Start</a> •
    <a href="#cli-reference">CLI</a> •
    <a href="#how-it-works">How It Works</a> •
    <a href="#ui-dashboard">Dashboard</a> •
    <a href="CONTRIBUTING.md">Contributing</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
    <img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node.js" />
    <img src="https://img.shields.io/badge/typescript-5.x-blue.svg" alt="TypeScript" />
  </p>
</p>

---

The Factory generates applications from declarative YAML stories. The current engine is centered on a deterministic TPM orchestrator that delegates code generation through the Pi SDK, monitors the session, and writes results back into the project bridge.

Write a story. Queue it up. Go to sleep. Wake up to working code.

## ✨ Features

- **🤖 Deterministic Orchestrator** — Builds a complete execution brief from story + blueprint context
- **🧠 Pi SDK Execution** — Uses the Pi SDK as the primary code generation path
- **🛡️ Session Monitoring** — Captures tool calls, output, and failures in per-story logs
- **📋 Dependency-Aware Queue** — Phase ordering and `dependsOn` gating — queue everything, the engine figures out the build order
- **📝 Chronicle System** — Auto-distills build history into compressed context for future builds
- **🌐 Provider-backed Pi Models** — Uses your configured provider credentials to resolve Pi model access
- **🖥️ Web Dashboard** — Next.js UI for story management, queue monitoring, build history, and settings

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- An LLM provider: [Google Gemini](https://ai.google.dev/), [OpenAI](https://platform.openai.com/), or [Ollama](https://ollama.ai/) (local, free)

### Install

```bash
git clone https://github.com/Bigmints-com/factory.git
cd factory
npm install
```

### Configure

```bash
# Create your settings file from the template
cp settings.example.json settings.json

# Edit settings.json — add your API key and enable a provider
# For local models, install Ollama and pull a model:
#   ollama pull llama3
```

### Connect a Project

```bash
# Connect your repo to the factory
npx tsx engine/cli.ts project add /path/to/your/repo

# This creates a .factory/ directory in your repo with:
#   factory.yaml          — project config
#   stories/apps/         — app story files
#   stories/features/     — feature story files
```

### Build

```bash
# Write a story (see template.yaml for the full schema)
# Place it in your repo: .factory/stories/apps/my-app.yaml

# Build a single story
npx tsx engine/cli.ts build .factory/stories/apps/my-app.yaml

# Or queue multiple stories and process autonomously
npx tsx engine/cli.ts queue add .factory/stories/apps/my-app.yaml
npx tsx engine/cli.ts queue add .factory/stories/features/auth.yaml
npx tsx engine/cli.ts queue start
```

### Dashboard

```bash
./start.sh     # http://localhost:11498
```

## CLI Reference

```
factory <command> [options]
```

| Command                   | Description                                                    |
| ------------------------- | -------------------------------------------------------------- |
| `build <story.yaml>`      | Full pipeline: validate → orchestrate → Pi SDK → push          |
| `validate <story.yaml>`   | Validate a story without building                              |
| `status`                  | Show all story statuses                                        |
| `sync <repo-path>`        | Check .factory sync state                                      |
| `init-bridge <repo-path>` | Initialize .factory bridge in a repo                           |

### Project Management

| Command                   | Description           |
| ------------------------- | --------------------- |
| `project add <repo-path>` | Connect a repository  |
| `project list`            | List connected repos  |
| `project switch <id>`     | Switch active project |
| `project remove <id>`     | Disconnect a repo     |

### Feature Builds

| Command                         | Description                          |
| ------------------------------- | ------------------------------------ |
| `feature build <story.yaml>`    | Build a feature into an existing app |
| `feature validate <story.yaml>` | Validate a feature story             |

### Build Queue

| Command                 | Description                            |
| ----------------------- | -------------------------------------- |
| `queue list`             | List queueable stories and their state  |
| `queue add <story.yaml>` | Mark a story as queued                  |
| `queue start`            | Process queued items sequentially       |
| `queue clear`            | Reset stale running items to queued     |

> All CLI commands run via `npx tsx engine/cli.ts <command>`.

## How It Works

```
You write a story → Queue it → Factory builds it → You wake up to working code
```

### The Build Pipeline

Each story goes through this pipeline:

1. **Load** — Reads story YAML, validates schema (`story.ts`)
2. **Gather** — Builds blueprint: knowledge files, conventions, chronicle, build logs (`blueprint.ts`)
3. **Orchestrate** — TPM orchestrator builds an execution brief with full context (`orchestrate.ts`)
4. **Execute** — Factory runs the brief through the Pi SDK session (`cli-session.ts`)
5. **Monitor** — Session logging captures text, tool calls, and tool results
6. **Decide** — Factory marks the story `done` or `failed` and writes a receipt
7. **Write** — Generated files are already on disk; engine records metadata and receipts
8. **Push** — Git commit and push, archive story to `done/`, distill chronicle

## Story Format

### App Story

```yaml
appName: "Inventory Tracker"
description: "A web app to track warehouse inventory"

stack:
  framework: next.js # next.js | remix | vite | astro
  packageManager: pnpm # pnpm | npm | yarn
  language: typescript
  linter: eslint # eslint | biome | none
  testing: vitest # vitest | jest | none
  database: supabase # supabase | postgres | firestore | none

auth:
  provider: firebase
  methods:
    email: true
    google: true

data:
  tables:
    - name: items
      fields:
        title: { type: string, required: true }
        quantity: { type: number, default: 0 }

pages:
  dashboard: ["overview", "settings"]
  crud: [{ table: items }]

deployment:
  port: 3000
```

See [template.yaml](template.yaml) for the full schema with all options.

### Feature Story

```yaml
feature:
  name: Barcode Scanner
  slug: barcode-scanner

target:
  app: inventory-tracker

phase: 2 # 1 = foundation, 2 = core, 3 = polish
dependsOn: [auth-system] # Must complete before this builds

model:
  collection: scans
  fields:
    - { name: barcode, type: string, required: true }
    - { name: scannedAt, type: datetime }

pages:
  - { slug: scan, type: form, title: "Scan Barcode" }
  - { slug: history, type: list, title: "Scan History" }
```

## Architecture

```
factory/
├── engine/                 ← Core build engine (TypeScript, runs via npx tsx)
│   ├── cli.ts              ← CLI entry point & command dispatcher
│   ├── config.ts           ← Config loading (projects, settings, bridge)
│   ├── story.ts            ← YAML story parsing & validation
│   ├── blueprint.ts        ← Knowledge, conventions & project context gathering
│   ├── orchestrate.ts      ← TPM orchestrator: brief assembly → Pi SDK execution
│   ├── generate.ts         ← LLM API client (callProviderWithTools) + pipeline wrappers
│   ├── cli-adapter.ts      ← Legacy non-Pi CLI compatibility helpers
│   ├── writer.ts           ← File writing, npm install, git ops, knowledge feedback
│   ├── db.ts               ← Build logs (YAML-based)
│   ├── queue.ts            ← Historical queue module reference
│   ├── health.ts           ← State audit, heartbeat, error categorisation
│   ├── chronicle.ts        ← Auto-distill build history into knowledge context
│   ├── rollup.ts           ← Scaffold.yaml sync & progress rollup
│   ├── skills.ts           ← Skill registry and execution
│   ├── init.ts             ← Project initialisation & bridge setup
│   ├── toon.ts             ← TOON/YAML read/write helpers, heartbeat writer
│   ├── build-tools.ts      ← Build tool definitions for LLM tool-calling
│   ├── worker-engine.ts    ← Legacy worker engine
│   ├── daemon.ts           ← Daemon lifecycle (start/stop)
│   ├── repl.ts             ← Interactive REPL for LLM providers
│   ├── types.ts            ← Shared TypeScript types
│   └── log.ts              ← Structured coloured logging
├── ui/                     ← Next.js dashboard (port 11498)
├── start.sh                ← Start script
├── template.yaml           ← Story template
└── package.json
```

## UI Dashboard

Start with `./start.sh` → **http://localhost:11498**

- **Dashboard** — Project overview and story statuses
- **Story Editor** — Create and edit story YAML files
- **Queue View** — Monitor builds in real time
- **Build History** — Browse past builds and results
- **Settings** — Configure LLM providers, API keys, and models

## Configuration

### LLM Providers (`settings.json`)

Configure one or more providers:

| Provider   | Requirements                                                          |
| ---------- | --------------------------------------------------------------------- |
| **Gemini** | API key from [Google AI Studio](https://ai.google.dev/)               |
| **OpenAI** | API key from [OpenAI Platform](https://platform.openai.com/)          |
| **Ollama** | Local install from [ollama.ai](https://ollama.ai/) — free, no API key |

### Project Bridge (`.Bigmints-com/factory.yaml`)

Each connected repo has a `.Bigmints-com/factory.yaml` that defines:

```yaml
version: 1
name: my-project
description: "My awesome project"
stack:
  framework: next.js
  packageManager: pnpm
apps_dir: apps # Where generated apps go (optional)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and PR guidelines.

## Documentation

- [userguide.md](userguide.md) — Detailed walkthrough of how the factory works
- [AGENTS.md](AGENTS.md) — Project structure, conventions, and common tasks

## License

[MIT](LICENSE) © Factory
