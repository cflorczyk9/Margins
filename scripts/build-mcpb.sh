#!/usr/bin/env bash
# Build the Margins .mcpb Desktop Extension bundle.
#
# Produces: dist/margins-<version>.mcpb (a zip archive with .mcpb extension)
#
# Bundle layout:
#   margins.mcpb/
#     manifest.json          (from mcpb/manifest.json)
#     icon.png               (from mcpb/icon.png)
#     server/
#       package.json
#       bin/
#       src/
#       node_modules/        (production-only, frozen for portability)
#
# Cross-platform: our dependencies are pure JS (@modelcontextprotocol/sdk, zod).
# No native bindings to deal with — one bundle works on macOS, Linux, Windows.

set -euo pipefail

# Resolve repo root regardless of where the script is invoked from.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

VERSION=$(node -p "require('./package.json').version")
BUNDLE_NAME="margins-mcp-${VERSION}.mcpb"
DIST_DIR="$REPO_ROOT/dist"
STAGE_DIR="$DIST_DIR/.stage"

echo "Building Margins .mcpb v${VERSION}"

# Clean previous build artifacts for this version (avoid stale node_modules).
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/server"
mkdir -p "$DIST_DIR"

# Copy manifest + icon at the bundle root.
cp "$REPO_ROOT/mcpb/manifest.json" "$STAGE_DIR/manifest.json"
cp "$REPO_ROOT/mcpb/icon.png" "$STAGE_DIR/icon.png"

# Copy the server source.
cp -R "$REPO_ROOT/bin" "$STAGE_DIR/server/"
cp -R "$REPO_ROOT/src" "$STAGE_DIR/server/"
cp "$REPO_ROOT/package.json" "$STAGE_DIR/server/package.json"
cp "$REPO_ROOT/package-lock.json" "$STAGE_DIR/server/package-lock.json"
cp "$REPO_ROOT/LICENSE" "$STAGE_DIR/server/LICENSE" 2>/dev/null || true
cp "$REPO_ROOT/README.md" "$STAGE_DIR/server/README.md" 2>/dev/null || true

# Install production-only deps into the staged server/ directory.
echo "  Installing production dependencies into bundle..."
cd "$STAGE_DIR/server"
npm ci --omit=dev --no-audit --no-fund --silent
cd "$REPO_ROOT"

# Verify package.json version matches manifest.json version — keeps channels in lockstep.
MANIFEST_VERSION=$(node -p "require('./mcpb/manifest.json').version")
if [ "$VERSION" != "$MANIFEST_VERSION" ]; then
  echo "ERROR: package.json version ($VERSION) != mcpb/manifest.json version ($MANIFEST_VERSION)."
  echo "  Bump both before building."
  exit 1
fi

# Produce the .mcpb (zip archive, .mcpb extension).
echo "  Packaging as $BUNDLE_NAME..."
cd "$STAGE_DIR"
zip -qr "$DIST_DIR/$BUNDLE_NAME" .
cd "$REPO_ROOT"

# Cleanup the staging directory; keep the .mcpb.
rm -rf "$STAGE_DIR"

# Also produce an unversioned copy. The unversioned name is what the
# "Download" button on margins.app links to, via GitHub's stable URL:
#   https://github.com/cflorczyk9/Margins/releases/latest/download/margins-mcp.mcpb
# The versioned copy is kept for archival use (multiple versions in Downloads/).
cp "$DIST_DIR/$BUNDLE_NAME" "$DIST_DIR/margins-mcp.mcpb"

BUNDLE_SIZE=$(du -h "$DIST_DIR/$BUNDLE_NAME" | cut -f1)
echo "  Built $DIST_DIR/$BUNDLE_NAME ($BUNDLE_SIZE)"
echo "  Also wrote $DIST_DIR/margins-mcp.mcpb (unversioned, for stable download URL)"
echo ""
echo "To test locally:"
echo "  open $DIST_DIR/$BUNDLE_NAME"
echo ""
echo "Or drag-and-drop the file onto Claude Desktop."
