# Validate Code Skill

## Purpose

This skill ensures that all code passes linter rules and compiles successfully before an agent completes a task.

## When to use

Agents MUST execute this skill _before_ finalizing any feature or bug fix and _before_ committing code.

## Available Scripts

### `validate.sh`

**Usage:**

```bash
./.agents/skills/validate-code/validate.sh
```

If it fails, the agent must read the output and automatically apply fixes to resolve any compilation or linting errors before moving forward.
