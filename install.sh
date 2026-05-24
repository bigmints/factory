#!/usr/bin/env bash
set -e

echo "🏭 Installing Factory globally..."

# Build UI
echo "📦 Building UI..."
cd ui
npm install
npm run build
cd ..

# Ensure .factory exists
FACTORY_DIR="$HOME/.factory"
mkdir -p "$FACTORY_DIR/ui"

# Find standalone output directory dynamically (handles Next.js monorepo nesting)
STANDALONE_DIR=$(dirname "$(find ui/.next/standalone -not -path "*/node_modules/*" -name server.js | head -n 1)")

# Copy standalone build to ~/.factory/ui
echo "🚚 Copying UI from $STANDALONE_DIR to $FACTORY_DIR/ui..."
rsync -a --exclude=".git" "$STANDALONE_DIR/" "$FACTORY_DIR/ui/"
if [ -d "$STANDALONE_DIR/node_modules" ]; then
    rsync -a "$STANDALONE_DIR/node_modules/" "$FACTORY_DIR/ui/node_modules/" 2>/dev/null || true
fi
mkdir -p "$FACTORY_DIR/ui/.next"
rsync -a ui/.next/static "$FACTORY_DIR/ui/.next/"
rsync -a ui/public/ "$FACTORY_DIR/ui/public/" 2>/dev/null || true

# Remove "type": "module" from the copied package.json so server.js executes as CommonJS
echo "🔧 Configuring package.json type for standalone server..."
node -e "
const fs = require('fs');
const file = '$FACTORY_DIR/ui/package.json';
if (fs.existsSync(file)) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.type = 'commonjs';
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2), 'utf8');
}
"

# Fix Turbopack mangled external package names
# Turbopack appends content hashes to external package names (e.g. better-sqlite3-bb6a0d79d57cc59a)
# We need to create symlinks so require() can resolve them at runtime
echo "🔗 Fixing Turbopack external module references..."
for chunk in "$FACTORY_DIR/ui/.next/server/chunks/"*.js; do
  # Extract mangled names like: better-sqlite3-bb6a0d79d57cc59a, yaml-f31d480adce24ec6
  for mangled in $(grep -oE '"[a-z][a-z0-9@/_.-]+-[0-9a-f]{16}"' "$chunk" 2>/dev/null | tr -d '"' | sort -u); do
    # Extract the base package name (everything before the last -<16 hex chars>)
    base=$(echo "$mangled" | sed -E 's/-[0-9a-f]{16}$//')
    if [ -d "$FACTORY_DIR/ui/node_modules/$base" ] && [ ! -e "$FACTORY_DIR/ui/node_modules/$mangled" ]; then
      ln -s "$base" "$FACTORY_DIR/ui/node_modules/$mangled"
      echo "  → Linked $mangled → $base"
    fi
  done
done

# Copy configs if they don't exist
if [ ! -f "$FACTORY_DIR/settings.json" ]; then
  cp settings.example.json "$FACTORY_DIR/settings.json"
fi

if [ ! -f "$FACTORY_DIR/projects.json" ]; then
  cp projects.example.json "$FACTORY_DIR/projects.json"
fi

# Seed default skills if directory doesn't exist yet
if [ ! -d "$FACTORY_DIR/skills" ] || [ -z "$(ls -A "$FACTORY_DIR/skills" 2>/dev/null)" ]; then
  echo "🧠 Seeding default skills..."
  mkdir -p "$FACTORY_DIR/skills"
  cp skills/defaults/*.md "$FACTORY_DIR/skills/" 2>/dev/null || true
fi

# Link CLI
echo "🔗 Linking global CLI command..."
npm link

echo "✅ Installed successfully!"
echo "Run 'factory start' to launch the UI on http://localhost:11498"
