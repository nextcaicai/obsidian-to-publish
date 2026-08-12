#!/usr/bin/env bash
# Package the four fixed GitHub Release assets for Obsidian to Publish.
# Output directory: dist/release/
#
# Assets:
#   1. main.js
#   2. manifest.json
#   3. styles.css
#   4. obsidian-to-publish-companion-<version>.zip
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PLUGIN_VERSION="$(node -p "require('./manifest.json').version")"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
COMPANION_VERSION="$(node -p "require('./chrome-companion/manifest.json').version")"

if [[ "$PLUGIN_VERSION" != "$PACKAGE_VERSION" ]]; then
	echo "error: package.json version ($PACKAGE_VERSION) != manifest.json version ($PLUGIN_VERSION)" >&2
	exit 1
fi

if [[ "$COMPANION_VERSION" != "$PLUGIN_VERSION" ]]; then
	echo "error: chrome-companion/manifest.json version ($COMPANION_VERSION) != plugin version ($PLUGIN_VERSION)" >&2
	echo "       Bump the companion version to match before packaging." >&2
	exit 1
fi

if ! node -e "const v=require('./versions.json'); if (!v['$PLUGIN_VERSION']) process.exit(1)"; then
	echo "error: versions.json is missing entry for $PLUGIN_VERSION" >&2
	exit 1
fi

echo "Building plugin $PLUGIN_VERSION..."
npm run build

OUT_DIR="$ROOT_DIR/dist/release"
COMPANION_STAGE="$OUT_DIR/obsidian-to-publish-companion"
ZIP_NAME="obsidian-to-publish-companion-${PLUGIN_VERSION}.zip"

rm -rf "$OUT_DIR"
mkdir -p "$COMPANION_STAGE"

# Obsidian plugin assets
cp "$ROOT_DIR/main.js" "$OUT_DIR/main.js"
cp "$ROOT_DIR/manifest.json" "$OUT_DIR/manifest.json"
cp "$ROOT_DIR/styles.css" "$OUT_DIR/styles.css"

# Chrome companion: single top-level folder for "Load unpacked"
# Do not nest an extra chrome-companion/ directory inside the zip.
rsync -a \
	--exclude '.DS_Store' \
	--exclude '*.map' \
	--exclude 'README.md' \
	"$ROOT_DIR/chrome-companion/" \
	"$COMPANION_STAGE/"

if [[ ! -f "$COMPANION_STAGE/manifest.json" ]]; then
	echo "error: companion staging directory missing manifest.json" >&2
	exit 1
fi

(
	cd "$OUT_DIR"
	# -X strips extra file attributes for more stable archives across machines
	zip -r -X -q "$ZIP_NAME" "obsidian-to-publish-companion"
)

# Keep only the four release assets in dist/release (drop the unpacked stage dir)
rm -rf "$COMPANION_STAGE"

echo
echo "Release assets ready in dist/release/:"
ls -la "$OUT_DIR"
echo
echo "Expected attach list:"
echo "  main.js"
echo "  manifest.json"
echo "  styles.css"
echo "  $ZIP_NAME"
