#!/usr/bin/env bash
# Re-vendor compiler.js + wiki.js + utils.js from the parent margins/src tree.
# The mcp/ package needs to be self-contained for npm publish, so the compiler
# is vendored here rather than imported across directories.
#
# Run this after editing src/compiler.js, src/core/wiki.js, or src/core/utils.js
# upstream. Verifies tests still pass after re-vendoring.

set -euo pipefail

MCP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MARGINS_DIR="$(cd "$MCP_DIR/.." && pwd)"
DEST="$MCP_DIR/src/compiler"

mkdir -p "$DEST"

for f in src/compiler.js src/core/wiki.js src/core/utils.js; do
  basename=$(basename "$f")
  src="$MARGINS_DIR/$f"
  out="$DEST/$basename"
  {
    printf '// VENDORED from margins/%s\n// Source of truth: ../../../%s\n// When the upstream changes, re-vendor with mcp/scripts/vendor-compiler.sh.\n\n' "$f" "$f"
    cat "$src"
  } > "$out"
done

sed -i.bak 's|"./core/wiki.js"|"./wiki.js"|g' "$DEST/compiler.js"
rm "$DEST/compiler.js.bak"

echo "Re-vendored compiler files to $DEST"
echo "Running tests..."
cd "$MCP_DIR"
node --test "tests/*.test.js" >/dev/null 2>&1 && echo "All tests pass." || {
  echo "Tests failed. Inspect with: cd mcp && node --test 'tests/*.test.js'"
  exit 1
}
