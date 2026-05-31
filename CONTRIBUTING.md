# Contributing to Factory

Thank you for your interest in contributing! This guide will help you get set up and understand the project structure.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/Bigmints-com/factory.git
cd factory

# Install dependencies
npm install

# Set up configuration
cp settings.example.json settings.json   # Edit with your LLM API keys
cp projects.example.json projects.json   # Edit with your project paths

# Start the UI dashboard
./start.sh     # http://localhost:11498

# Run the CLI
npx tsx engine/cli.ts status
```

## Project Structure

```
factory/
├── engine/                 ← Core build engine (TypeScript, runs via npx tsx)
│   ├── cli.ts              ← CLI entry point & command dispatcher
│   ├── config.ts           ← Config loading (projects, settings, bridge)
│   ├── story.ts            ← YAML story parsing & validation
│   ├── blueprint.ts        ← Knowledge, conventions & project context gathering
│   ├── orchestrate.ts      ← TPM orchestrator: LLM loop → CLI delegation → monitoring
│   ├── generate.ts         ← LLM API client (callProviderWithTools) + pipeline wrappers
│   ├── cli-adapter.ts      ← CLI binary resolution (agy, gemini, claude, pi)
│   ├── writer.ts           ← File writing, git ops, knowledge feedback
│   ├── db.ts               ← Build logs (YAML-based)
│   ├── queue.ts            ← Dependency-aware build queue (YAML-based)
│   ├── health.ts           ← State audit, heartbeat, error categorisation
│   ├── chronicle.ts        ← Auto-distill build history into knowledge context
│   ├── rollup.ts           ← Scaffold.yaml sync & progress rollup
│   ├── skills.ts           ← Skill registry and execution
│   ├── init.ts             ← Project initialisation & bridge setup
│   ├── toon.ts             ← TOON/YAML read/write helpers
│   ├── build-tools.ts      ← Build tool definitions for LLM tool-calling
│   ├── worker-engine.ts    ← Worker engine for YAML prompt queue processing
│   ├── daemon.ts           ← Daemon lifecycle (start/stop)
│   ├── repl.ts             ← Interactive REPL for LLM providers
│   ├── types.ts            ← Shared TypeScript types
│   └── log.ts              ← Structured coloured logging
├── ui/                     ← Next.js dashboard (port 11498)
│   └── src/
│       ├── app/api/        ← API routes
│       └── components/     ← UI components
├── start.sh                ← Start script
├── template.yaml           ← Story template
└── package.json
```

## Common Tasks

### Adding a New CLI Command

1. Add the command handler function in `engine/cli.ts`
2. Wire it into the `switch (command)` dispatcher in `main()`
3. Add it to `printUsage()` help text
4. If the command needs a new engine module, create `engine/<module>.ts`
5. Add an API route in `ui/src/app/api/` if UI access is needed

### Adding a New Story Field

1. Update the type in `engine/types.ts` (`AppStory` or `FeatureStory`)
2. Add validation in `engine/story.ts` → `validateStory()`
3. Update prompts in `engine/orchestrate.ts` to use the new field in context
4. Update `template.yaml` with an example

### Adding a New UI Feature

1. Create the component in `ui/src/components/`
2. Add an API route in `ui/src/app/api/` if backend access is needed
3. Wire into the dashboard
4. Add to sidebar navigation

## Code Style

- **Engine**: Pure TypeScript, runs via `npx tsx`. No transpilation step.
- **UI**: Next.js 15, App Router, shadcn/ui, Tailwind CSS.
- **State**: YAML files for queue/builds (`~/.factory/`), JSON for projects/settings (`~/.factory/`).
- **Stories**: YAML, validated against typed schemas in `types.ts`.
- Run `npm run lint` and `npm run typecheck` before submitting.

## Pull Request Guidelines

1. **Fork** the repo and create a feature branch
2. Make your changes with clear, descriptive commit messages
3. Ensure `npm run lint` and `npm run typecheck` pass
4. Open a PR with a description of what you changed and why
5. Link any related issues

## Reporting Issues

- Use GitHub Issues
- Include steps to reproduce, expected vs actual behaviour
- Include your Node.js version (`node --version`) and OS

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
