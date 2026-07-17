#!/usr/bin/env bash
set -e

echo "🏭 Installing Factory globally..."

if ! command -v npm >/dev/null 2>&1; then
  NVM_NODE_BIN=$(find "$HOME/.nvm/versions/node" -maxdepth 3 -type f -name node 2>/dev/null | sort -V | tail -n 1 | xargs dirname 2>/dev/null || true)
  if [ -n "$NVM_NODE_BIN" ]; then
    export PATH="$NVM_NODE_BIN:$PATH"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm not found. Install Node.js or add npm to PATH before running make install."
  exit 1
fi

# Build UI
echo "📦 Building UI..."
cd ui
npm install
npm run build
cd ..

# Ensure .factory exists
FACTORY_DIR="$HOME/.factory"
mkdir -p "$FACTORY_DIR/ui"

# Install the engine runtime into ~/.factory so the `factory` command does not
# depend on a source checkout or `npm link`.
echo "🚚 Installing engine runtime to $FACTORY_DIR..."
rsync -a --delete --exclude=".git" engine "$FACTORY_DIR/"
rsync -a --delete --exclude=".git" bin "$FACTORY_DIR/"
rsync -a --delete --exclude=".git" factory "$FACTORY_DIR/"
rsync -a --delete --exclude=".git" skills "$FACTORY_DIR/"
cp package.json "$FACTORY_DIR/package.json"
if [ -f package-lock.json ]; then
  cp package-lock.json "$FACTORY_DIR/package-lock.json"
fi
if [ -f tsconfig.json ]; then
  cp tsconfig.json "$FACTORY_DIR/tsconfig.json"
fi

echo "📦 Installing engine dependencies..."
(cd "$FACTORY_DIR" && npm install)

# Find standalone output directory dynamically (handles Next.js monorepo nesting)
STANDALONE_DIR=$(dirname "$(find ui/.next/standalone -not -path "*/node_modules/*" -name server.js | head -n 1)")

# Copy standalone build to ~/.factory/ui
echo "🚚 Copying UI from $STANDALONE_DIR to $FACTORY_DIR/ui..."
rsync -a --delete --exclude=".git" "$STANDALONE_DIR/" "$FACTORY_DIR/ui/"
if [ -d "$STANDALONE_DIR/node_modules" ]; then
    rsync -a "$STANDALONE_DIR/node_modules/" "$FACTORY_DIR/ui/node_modules/" 2>/dev/null || true
fi
if [ ! -f "$FACTORY_DIR/ui/server.js" ] && [ -f "$FACTORY_DIR/ui/server.cjs" ]; then
  cp "$FACTORY_DIR/ui/server.cjs" "$FACTORY_DIR/ui/server.js"
fi
if [ ! -f "$FACTORY_DIR/ui/server.js" ] && [ -f "$STANDALONE_DIR/server.js" ]; then
  cp "$STANDALONE_DIR/server.js" "$FACTORY_DIR/ui/server.js"
fi
if [ ! -f "$FACTORY_DIR/ui/server.js" ]; then
  echo "❌ Next standalone server not found in installed UI."
  exit 1
fi
mkdir -p "$FACTORY_DIR/ui/.next"
rsync -a --delete ui/.next/static "$FACTORY_DIR/ui/.next/"
rsync -a --delete ui/public/ "$FACTORY_DIR/ui/public/" 2>/dev/null || true

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

# Seed default runtime skills. Keep user-edited skill files unless replaced by
# the installed canonical default.
echo "🧠 Seeding default skills..."
mkdir -p "$FACTORY_DIR/skills"
cp skills/defaults/*.md "$FACTORY_DIR/skills/" 2>/dev/null || true
cp skills/story-generator/SKILL.md "$FACTORY_DIR/skills/story-generator.md" 2>/dev/null || true
cp skills/delivery-kernel/SKILL.md "$FACTORY_DIR/skills/delivery-kernel.md" 2>/dev/null || true

# Link CLI without keeping a source checkout around.
echo "🔗 Linking factory command..."
mkdir -p "$HOME/.local/bin"
ln -sfn "$FACTORY_DIR/bin/factory" "$HOME/.local/bin/factory"
chmod +x "$FACTORY_DIR/bin/factory"
if command -v factory >/dev/null 2>&1; then
  echo "  → factory resolves to $(command -v factory)"
elif [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  echo "  → Add $HOME/.local/bin to PATH to use the factory command"
fi

echo "✅ Installed successfully!"
echo "Run 'factory start' to launch the UI on http://localhost:11498"
