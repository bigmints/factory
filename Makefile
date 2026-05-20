.PHONY: help install dev ui lint typecheck repl status

# Default target: show help
help:
	@echo "🏭 \033[1;36mFactory Build Engine Makefile\033[0m"
	@echo "Available commands:"
	@echo "  \033[1;32mmake install\033[0m   Build the Next.js UI and install the factory CLI globally"
	@echo "  \033[1;32mmake dev\033[0m       Start the Next.js UI development server (port 4090)"
	@echo "  \033[1;32mmake ui\033[0m        Start the Next.js UI development server (port 3001)"
	@echo "  \033[1;32mmake lint\033[0m      Run ESLint code style check on the build engine"
	@echo "  \033[1;32mmake typecheck\033[0m Run TypeScript type-checking"
	@echo "  \033[1;32mmake status\033[0m    Check the status of all specifications"
	@echo "  \033[1;32mmake repl\033[0m      Launch the beautiful interactive CLI terminal UI REPL"

install:
	@echo "🚀 Running installation script..."
	chmod +x install.sh
	./install.sh

dev:
	npm run dev

ui:
	npm run ui

lint:
	npm run lint

typecheck:
	npm run typecheck

status:
	npx tsx engine/cli.ts status

repl:
	npx tsx engine/cli.ts repl
