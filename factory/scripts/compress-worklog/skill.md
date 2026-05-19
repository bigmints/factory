# Compress Worklog Skill

## Purpose

Prevents the `.agents/context/worklog.toon` file from becoming too large and consuming excessive LLM context tokens.

## When to use

Agents SHOULD execute this skill periodically, especially if they notice the worklog has grown beyond 15-20 entries.

## Available Scripts

### `compress.sh`

**Usage:**

```bash
./.agents/skills/compress-worklog/compress.sh
```

This will automatically safely archive older entries, keeping the 10 most recent entries intact alongside a summary of the archived history.
