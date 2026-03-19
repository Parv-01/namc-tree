#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# scripts/build.sh
#
# Build script — copies source files to dist/ and injects
# GitHub Secrets (passed as environment variables) into api.js.
#
# Run locally for testing:
#   APPS_SCRIPT_URL="https://..." NAMC_API_KEY="mykey" bash scripts/build.sh
#
# Run by GitHub Actions automatically on push to main.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

echo "──────────────────────────────────────────"
echo "  NAMC Tree — Build Script"
echo "──────────────────────────────────────────"

# ── 1. Clean and create dist/ ───────────────────────────────────
rm -rf dist
mkdir -p dist/backend dist/scripts dist/.github/workflows

# ── 2. Copy all static files ─────────────────────────────────────
echo "Copying source files…"
cp index.html   dist/
cp style.css    dist/
cp data.js      dist/
cp tree_data.js dist/
cp tree.js      dist/
cp store.js     dist/
cp app.js       dist/
cp README.md    dist/
cp LICENSE      dist/
cp backend/Code.gs   dist/backend/
cp scripts/generate_data_js.py dist/scripts/

# api.js is handled separately below (secret injection)
cp api.js dist/api.js

# ── 3. Inject secrets into dist/api.js ───────────────────────────
echo "Injecting secrets into api.js…"

# Read env vars (fall back to empty string if not set)
URL="${APPS_SCRIPT_URL:-}"
KEY="${NAMC_API_KEY:-}"

if [ -z "$URL" ]; then
  echo "  ⚠  APPS_SCRIPT_URL is not set — API will run in offline mode."
  ENABLED="false"
else
  echo "  ✓  APPS_SCRIPT_URL set (${#URL} chars)"
  ENABLED="true"
fi

if [ -z "$KEY" ]; then
  echo "  ⚠  NAMC_API_KEY is not set — write operations will be unauthenticated."
fi

# Replace placeholder tokens using Python (handles special chars safely)
python3 - <<PYEOF
import re, os

with open('dist/api.js', 'r', encoding='utf-8') as f:
    content = f.read()

replacements = {
    '__APPS_SCRIPT_URL__': os.environ.get('APPS_SCRIPT_URL', ''),
    '__NAMC_API_KEY__':    os.environ.get('NAMC_API_KEY', ''),
    '__API_ENABLED__':     'true' if os.environ.get('APPS_SCRIPT_URL') else 'false',
}

for token, value in replacements.items():
    content = content.replace(token, value)

with open('dist/api.js', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"  Replaced {len(replacements)} tokens in api.js")
PYEOF

# ── 4. Print summary ──────────────────────────────────────────────
echo ""
echo "Build complete. dist/ contents:"
ls -lh dist/
echo ""
echo "API enabled: ${ENABLED}"
echo "──────────────────────────────────────────"
