import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";

export const HOSTS = {
  "claude-desktop": {
    label: "Claude Desktop",
    configPath: () => {
      const home = os.homedir();
      switch (process.platform) {
        case "darwin":
          return path.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
        case "linux":
          return path.join(home, ".config/Claude/claude_desktop_config.json");
        case "win32":
          return path.join(
            process.env.APPDATA || path.join(home, "AppData/Roaming"),
            "Claude/claude_desktop_config.json"
          );
        default:
          return null;
      }
    },
    restartHint:
      "Quit Claude Desktop fully (Cmd-Q on macOS, not just close the window) and reopen it."
  },
  "claude-code": {
    label: "Claude Code",
    configPath: () => path.join(os.homedir(), ".claude.json"),
    restartHint:
      "Run `/mcp` inside any Claude Code session to confirm Margins is listed."
  }
};

export async function detectHosts() {
  const results = [];
  for (const [id, host] of Object.entries(HOSTS)) {
    const configPath = host.configPath();
    if (!configPath) {
      results.push({ id, label: host.label, configPath: null, status: "unsupported-platform" });
      continue;
    }
    let exists = false;
    let dirExists = false;
    try {
      await stat(configPath);
      exists = true;
      dirExists = true;
    } catch {
      try {
        await stat(path.dirname(configPath));
        dirExists = true;
      } catch {
        dirExists = false;
      }
    }
    results.push({
      id,
      label: host.label,
      configPath,
      status: exists ? "present" : dirExists ? "config-missing" : "host-missing",
      restartHint: host.restartHint
    });
  }
  return results;
}
