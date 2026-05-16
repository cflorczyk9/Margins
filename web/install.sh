#!/usr/bin/env bash
# Margins one-paster install.
#
#   curl -fsSL https://marginsmcp.com/install | bash
#
# Or inspect first (recommended for any script you pipe to bash):
#
#   curl -fsSL https://marginsmcp.com/install > install.sh
#   less install.sh
#   bash install.sh
#
# What this does:
#   1. Checks Node 18+ is installed.
#   2. npm-installs margins-mcp globally.
#   3. Runs `margins-mcp install` — which auto-detects your Obsidian vault
#      (reads ~/Library/Application Support/obsidian/obsidian.json on macOS,
#      ~/.config/obsidian/obsidian.json on Linux, %APPDATA%/obsidian/ on
#      Windows), wires margins into Claude Desktop and Claude Code, and
#      runs a verification probe.
#
# This script is idempotent. Running it twice updates margins-mcp to the
# latest version and re-runs the installer.

set -e

# Pretty printing (no-op when not a tty).
if [ -t 1 ]; then
  RED=$'\033[0;31m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[1;33m'
  BLUE=$'\033[0;34m'
  BOLD=$'\033[1m'
  RESET=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

say()  { printf "${BLUE}>${RESET} %s\n" "$1"; }
ok()   { printf "${GREEN}OK${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}!${RESET} %s\n" "$1"; }
err()  { printf "${RED}X${RESET} %s\n" "$1" >&2; }

printf "\n${BOLD}Margins${RESET} - one-command install\n"
printf "  Source: https://github.com/cflorczyk9/Margins\n"
printf "  npm:    https://www.npmjs.com/package/margins-mcp\n\n"

say "Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found."
  echo ""
  echo "  Margins needs Node.js 18 or newer. Install from https://nodejs.org"
  echo "  (or via brew, nvm, asdf, fnm, etc.) and re-run this command."
  exit 1
fi
NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node $NODE_VERSION is too old. Margins needs Node 18+."
  echo "  Update from https://nodejs.org and re-run."
  exit 1
fi
ok "Node $NODE_VERSION"

say "Checking npm..."
if ! command -v npm >/dev/null 2>&1; then
  err "npm not found (unusual - it ships with Node)."
  exit 1
fi
ok "npm $(npm --version)"

say "Installing margins-mcp globally..."
if npm install -g margins-mcp >/dev/null 2>&1; then
  ok "margins-mcp installed"
else
  warn "Global npm install failed (often a permissions issue)."
  echo ""
  echo "  Try one of these and re-run:"
  echo "    sudo npm install -g margins-mcp        # quick, requires sudo"
  echo "    brew install node                      # macOS, brew-managed Node"
  echo "    nvm install --lts && nvm use --lts     # user-scoped Node via nvm"
  exit 1
fi

echo ""
say "Running margins-mcp install - it'll find your Obsidian vault automatically."
echo ""
margins-mcp install "$@"

printf "\n${GREEN}${BOLD}Done.${RESET}\n"
echo ""
echo "Next:"
echo "  1. Quit Claude Desktop fully (Cmd-Q on macOS, not just close the window)."
echo "  2. Reopen it, start a new conversation, and ask:"
echo ""
echo "       Use margins_start to introduce yourself based on what's in my vault."
echo ""
echo "  3. In Claude Code: run /mcp to confirm Margins is listed."
