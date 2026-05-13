import path from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { detectHosts, HOSTS } from "./hosts.js";
import { writeMcpEntry } from "./config-writer.js";
import { probeServer } from "./probe.js";
import { scaffoldStarterVault } from "./starter-vault.js";
import { createPrompter } from "./prompt.js";
import { readConsent, writeConsent, createTelemetry } from "../telemetry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BIN = path.resolve(__dirname, "../../bin/margins-mcp.js");
const SERVER_NAME = "margins";

function parseArgs(argv) {
  const args = { yes: false, vault: null, starterVault: null, force: false, hosts: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--vault") args.vault = argv[++i];
    else if (arg.startsWith("--vault=")) args.vault = arg.slice("--vault=".length);
    else if (arg === "--starter-vault") args.starterVault = argv[++i];
    else if (arg.startsWith("--starter-vault=")) args.starterVault = arg.slice("--starter-vault=".length);
    else if (arg === "--hosts") args.hosts = argv[++i].split(",");
    else if (arg.startsWith("--hosts=")) args.hosts = arg.slice("--hosts=".length).split(",");
  }
  return args;
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function detectVaultDefault(cwd) {
  if (await pathExists(path.join(cwd, ".obsidian"))) return cwd;
  if (await pathExists(path.join(cwd, "wiki"))) return cwd;
  return null;
}

export async function runInstaller(argv = [], { log = console.log, errlog = console.error } = {}) {
  const args = parseArgs(argv);
  const prompter = createPrompter({ yes: args.yes });
  const result = { steps: [], errors: [] };

  try {
    let vaultPath = args.vault;

    if (args.starterVault) {
      const target = path.resolve(args.starterVault);
      log(`Scaffolding starter vault at ${target}...`);
      const scaffold = await scaffoldStarterVault(target, { force: args.force });
      log(`  Wrote ${scaffold.files.length} files across ${scaffold.folders.length} folders.`);
      vaultPath = target;
      result.steps.push({ kind: "starter-vault", target });
    }

    if (!vaultPath) {
      const guess = (await detectVaultDefault(process.cwd())) || process.cwd();
      vaultPath = await prompter.askText("Where is your vault?", { defaultValue: guess });
    }
    vaultPath = path.resolve(vaultPath);
    if (!(await pathExists(vaultPath))) {
      throw new Error(
        `Vault path does not exist: ${vaultPath}. Pass --starter-vault <path> to scaffold one.`
      );
    }
    log(`Vault: ${vaultPath}`);

    const detected = await detectHosts();
    const requested = args.hosts || detected.filter((h) => h.status !== "host-missing").map((h) => h.id);
    const toRegister = detected.filter((h) => requested.includes(h.id));

    if (toRegister.length === 0) {
      log("No supported hosts detected. Manual config:");
      log(JSON.stringify(manualConfigShape(vaultPath), null, 2));
      result.steps.push({ kind: "no-hosts-detected" });
      return result;
    }

    for (const host of toRegister) {
      if (host.status === "host-missing") {
        log(`  ${host.label}: not installed (skipping)`);
        continue;
      }
      const shouldRegister = await prompter.ask(`Register Margins with ${host.label}?`);
      if (!shouldRegister) {
        log(`  ${host.label}: skipped by user`);
        continue;
      }
      const writeResult = await writeMcpEntry({
        configPath: host.configPath,
        serverName: SERVER_NAME,
        command: "node",
        args: [SERVER_BIN],
        env: { MARGINS_VAULT: vaultPath }
      });
      log(
        `  ${host.label}: wrote config (preserved ${writeResult.peerCount} other MCP servers` +
          `${writeResult.replacedExisting ? "; replaced existing margins entry" : ""})`
      );
      result.steps.push({ kind: "host-registered", host: host.id, ...writeResult });
    }

    log("Verifying installation...");
    try {
      const probe = await probeServer({ serverBin: SERVER_BIN, vaultPath });
      const toolCount = probe.tools.length;
      log(`  Server starts. ${toolCount} tools registered.`);
      result.steps.push({ kind: "probe-ok", toolCount });
    } catch (err) {
      errlog(`  Probe failed: ${err.message}`);
      result.errors.push({ kind: "probe-failed", message: err.message });
    }

    const existingConsent = await readConsent();
    if (!existingConsent) {
      log("");
      log(
        "Margins can send anonymous tool-use counts to help me decide what to build next."
      );
      log("No vault content, no file paths, no IPs that aren't already in HTTP logs.");
      const agreed = await prompter.ask(
        "Opt in to anonymous telemetry?",
        { defaultYes: true }
      );
      await writeConsent({ enabled: agreed });
      log(
        agreed
          ? "  Telemetry: on. Run `MARGINS_TELEMETRY=off margins-mcp` to disable per-session."
          : "  Telemetry: off. You can opt in later by editing ~/.margins/consent.json."
      );
      result.steps.push({ kind: "telemetry-consent", enabled: agreed });
    } else {
      result.steps.push({ kind: "telemetry-consent-existing", enabled: existingConsent.enabled });
    }

    const consent = (await readConsent()) || {};
    const telemetry = createTelemetry({ consent });
    if (telemetry.enabled) {
      telemetry.fireAndForget("/install/completed");
    }

    log("\nDone.");
    for (const host of toRegister) {
      if (host.status !== "host-missing") {
        log(`  ${host.label}: ${host.restartHint}`);
      }
    }
    log('\nTry asking Claude: "Use margins to give me a summary of my recent notes."');
  } finally {
    prompter.close();
  }

  return result;
}

function manualConfigShape(vaultPath) {
  return {
    mcpServers: {
      [SERVER_NAME]: {
        command: "node",
        args: [SERVER_BIN],
        env: { MARGINS_VAULT: vaultPath }
      }
    }
  };
}
