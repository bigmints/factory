# Auto Blueprint Skill

## Purpose

This skill maintains the chronological worklog for the project automatically. It is used to record completed tasks, decisions, and feature implementations. The underlying storage uses TOON format (`.toon`) to minimize token consumption while maintaining LLM-friendly schemas.

## When to use

Agents MUST invoke this skill at the end of every active session or task block to document their progress before terminating or seeking user feedback.

## Available Scripts

### `update-blueprint.sh`

A shell script that wraps the TOON compilation logic.

**Usage:**

```bash
./.factory/blueprint/update-blueprint.sh "<Brief description of work completed>"
```

### `update-blueprint.mjs`

The internal ESM Node script that actually parses `.factory/blueprint/worklog.yaml` (encoded/decoded via TOON format), appends the new entry, and re-encodes the file natively. It is also triggered automatically by git's `post-commit` hook.
