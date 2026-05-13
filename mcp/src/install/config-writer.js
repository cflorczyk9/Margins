import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJsonSafe(configPath) {
  try {
    const text = await readFile(configPath, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    if (err instanceof SyntaxError) {
      throw new Error(
        `Config file at ${configPath} exists but is not valid JSON: ${err.message}`
      );
    }
    throw err;
  }
}

export async function writeMcpEntry({
  configPath,
  serverName,
  command,
  args,
  env
}) {
  const existing = (await readJsonSafe(configPath)) || {};
  const config = { ...existing };
  config.mcpServers = { ...(config.mcpServers || {}) };

  const previous = config.mcpServers[serverName];
  const entry = { command, args };
  if (env && Object.keys(env).length > 0) entry.env = env;
  config.mcpServers[serverName] = entry;

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  const peerCount = Object.keys(config.mcpServers).length - 1;
  return {
    configPath,
    replacedExisting: Boolean(previous),
    peerCount
  };
}
