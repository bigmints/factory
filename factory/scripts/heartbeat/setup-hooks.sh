#!/bin/bash
# setup-hooks.sh — Install Factory git hooks
# Usage: setup-hooks.sh [repo-path]

REPO_ROOT="${1:-.}"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
    echo "Error: $REPO_ROOT is not a git repository"
    exit 1
fi

# Pre-commit hook
cat > "$HOOKS_DIR/pre-commit" << 'HOOKEOF'
#!/bin/bash
# Factory pre-commit: warn about in-progress tasks

TODO_FILE="$(git rev-parse --show-toplevel)/.factory/task-manager/todo.yaml"
if [ ! -f "$TODO_FILE" ]; then
    TODO_FILE="$(git rev-parse --show-toplevel)/.factory/task-manager/todo.toon"
fi
if [ -f "$TODO_FILE" ]; then
    IN_PROGRESS=$(grep -c 'in_progress' "$TODO_FILE" 2>/dev/null || echo 0)
    if [ "$IN_PROGRESS" -gt 0 ]; then
        echo "⚠ Warning: There are in-progress tasks. Consider completing them first."
    fi
fi

# Write heartbeat before commit
FACTORY_HOME="$(git rev-parse --show-toplevel)"
if [ -f "$FACTORY_HOME/.factory/scripts/heartbeat/pulse.sh" ]; then
    FACTORY_PROJECT_ROOT="$FACTORY_HOME" "$FACTORY_HOME/.factory/scripts/heartbeat/pulse.sh" "pre-commit"
fi
HOOKEOF
chmod +x "$HOOKS_DIR/pre-commit"

# Post-commit hook
cat > "$HOOKS_DIR/post-commit" << 'HOOKEOF'
#!/bin/bash
# Factory post-commit: update context

FACTORY_HOME="$(git rev-parse --show-toplevel)"
if [ -f "$FACTORY_HOME/.factory/scripts/auto-context/update-context.sh" ]; then
    FACTORY_PROJECT_ROOT="$FACTORY_HOME" "$FACTORY_HOME/.factory/scripts/auto-context/update-context.sh" "post-commit"
fi
HOOKEOF
chmod +x "$HOOKS_DIR/post-commit"

echo "✓ Git hooks installed in $REPO_ROOT"
