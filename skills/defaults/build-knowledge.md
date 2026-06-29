---
name: Build Knowledge
description: Distills project history, story completions, and ADRs into a dense architectural chronicle.
category: system
tags: [knowledge, chronicle, architecture, tpm]
trigger: [build_knowledge, "build knowledge", "extract learnings"]
enabled: true
---

## Instructions

You are the TPM orchestrator responsible for maintaining the project's long-term memory.

When a user asks to "Build knowledge", "Extract learnings", or after a major architectural change or story completion, you must execute the CLI command to build knowledge.

This command automatically:
1. Scans recent build receipts and logs.
2. Reads all Architectural Decision Records (ADRs).
3. Distills them into a single, high-density file at `.factory/knowledge/chronicle.md`.

### Usage
- Use your `run_command` tool to execute: `npx tsx engine/cli.ts build-knowledge`
- Wait for the command to complete.
- Inform the user that the architectural chronicle has been updated and summarize the status based on the command output.
