#!/usr/bin/env node
import { runStdio } from "../src/server.js";

runStdio().catch((err) => {
  console.error("margins-mcp failed to start:", err);
  process.exit(1);
});
