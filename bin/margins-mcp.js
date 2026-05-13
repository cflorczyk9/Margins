#!/usr/bin/env node
import { runStdio } from "../src/server.js";

const [, , subcommand, ...rest] = process.argv;

if (subcommand === "install") {
  const { runInstaller } = await import("../src/install/index.js");
  try {
    await runInstaller(rest);
  } catch (err) {
    console.error("margins-mcp install failed:", err.message);
    process.exit(1);
  }
} else if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
  console.log(
    [
      "margins-mcp — read and propose writes to a Markdown vault via MCP",
      "",
      "Usage:",
      "  margins-mcp                              start the stdio MCP server (default)",
      "  margins-mcp install [options]            register Margins with Claude Desktop / Claude Code",
      "",
      "Install options:",
      "  --vault <path>          vault path (default: detected or prompted)",
      "  --starter-vault <path>  scaffold a Margins-shaped vault at <path>",
      "  --force                 allow scaffold into a non-empty directory",
      "  --hosts <list>          comma-separated host ids: claude-desktop,claude-code",
      "  --yes                   non-interactive (accept all defaults)"
    ].join("\n")
  );
  process.exit(0);
} else if (subcommand && !subcommand.startsWith("-")) {
  console.error(`Unknown subcommand: ${subcommand}. Try 'margins-mcp --help'.`);
  process.exit(1);
} else {
  runStdio().catch((err) => {
    console.error("margins-mcp failed to start:", err);
    process.exit(1);
  });
}
