---
title: Pre-Commit Validation
trigger: Before every git commit — mandatory
---

# Pre-Commit Validation

> Every check must pass before committing. No exceptions. No `--no-verify`.

---

## Steps

**1 — Type check**
```bash
npx tsc --noEmit
```
Must exit 0. If not → fix and re-run from Step 1.

**2 — Lint** *(if changed files include .ts/.tsx)*
```bash
npx eslint . --max-warnings=0
```
Must exit 0.

**3 — Self-review diff**
```
[ ] No debug console.log
[ ] No hardcoded absolute paths in source code
[ ] No placeholder values (xxx, todo, fixme)
[ ] No unused imports
[ ] No commented-out code blocks
```

**4 — Commit**
```bash
git commit -m "<type>(<scope>): <what and why>"
# Types: feat · fix · chore · refactor · adr
```

**5 — Post-commit heartbeat**
```bash
factory pulse "Committed: $(git log -1 --format='%s')"
```

**6 — Post-commit worklog**
```bash
factory blueprint update "$(git log -1 --format='%s')"
```

---

## Errors

| Failure | Action |
|---------|--------|
| tsc error | Fix → re-run from Step 1 |
| eslint error | Fix → re-run from Step 1 |
| 3+ failed attempts | STOP → escalate (format in `process.md §4`) |
