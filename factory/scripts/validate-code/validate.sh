#!/bin/bash
# validate-code/validate.sh
# Runs lint and type checks before committing.
# Must pass before any commit.

set -e

echo "Running code validation..."

npm run typecheck

if [ $? -ne 0 ]; then
    echo "TypeScript type check failed! Please fix the errors before proceeding."
    exit 1
fi

npm run lint

if [ $? -ne 0 ]; then
    echo "Linting failed! Please fix the errors before proceeding."
    exit 1
fi

echo "All checks passed successfully."
exit 0
