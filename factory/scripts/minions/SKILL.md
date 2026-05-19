---
name: minions
description: Execute a YAML prompt queue sequentially against the pi (Gemini) CLI without manual intervention. Supports dry-run preview, per-prompt overrides, and run logs.
---

# Minions — YAML Prompt Queue Runner

**Triggers:** "run my queue" | "execute the queue" | "batch these tasks" | "schedule these prompts"

**Requires:** `pi` or `gemini` CLI installed and on PATH.

---

## Quick Start

```bash
# Run a queue file
./.agents/skills/minions/scripts/minions --queue queue.yaml

# Preview without executing
./.agents/skills/minions/scripts/minions --queue queue.yaml --dry-run
```

---

## Queue File Format

```yaml
queue:
  - name: 'Task label' # required — shown in logs
    prompt: 'Full prompt text' # required
    workdir: /path/to/dir # optional — override per prompt
    model: gemini-2.0-flash # optional — override per prompt
    approval_mode: auto_edit # optional — default | auto_edit | yolo
```

**Search order for queue file (when `--queue` is omitted):**

1. `./queue.yaml`
2. `./prompts.yaml`
3. `./batch.yaml`
4. `.agents/queue/` directory (first `.yaml` file found)

---

## CLI Flags

| Flag                     | Default     | Description                           |
| ------------------------ | ----------- | ------------------------------------- |
| `--queue <file>`         | required    | Path to YAML queue file               |
| `--workdir <dir>`        | `.`         | Working directory for all prompts     |
| `--approval-mode <mode>` | `yolo`      | `default` \| `auto_edit` \| `yolo`    |
| `--dry-run`              | off         | Print prompts without executing       |
| `--continue-on-error`    | off         | Don't abort queue on failure          |
| `--model <model>`        | CLI default | Override Gemini model for all prompts |
| `--delay <seconds>`      | `2`         | Wait between prompts                  |
| `--log-dir <dir>`        | `./runs/`   | Run log output directory              |

---

## Run Logs

Each run writes `<log-dir>/run-<timestamp>.log` with per-task status, exit codes, and elapsed time.
Check `.agents/queue/status.md` for recent run history if you maintain one.

---

## TOON Context Compression (Optional Pre-Run Step)

If any prompt references large JSON context files, compress them first to save tokens:

```bash
npx @toon-format/cli <file.json> --stats         # check savings
npx @toon-format/cli <file.json> -o <file.toon>  # write compressed file
```

Then inject the TOON block into the prompt before running the queue.
Skip if savings are under 10%.
