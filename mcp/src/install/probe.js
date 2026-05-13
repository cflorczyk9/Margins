import { spawn } from "node:child_process";

export async function probeServer({ serverBin, vaultPath, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverBin], {
      env: { ...process.env, MARGINS_VAULT: vaultPath },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdoutBuf = "";
    let initialized = false;
    let toolsList = null;
    let finished = false;

    const finish = (result, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {}
      if (error) reject(error);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      finish(null, new Error(`probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => finish(null, err));
    child.on("exit", (code, signal) => {
      if (!finished) {
        finish(null, new Error(`server exited prematurely (code=${code}, signal=${signal})`));
      }
    });

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString("utf8");
      for (let nl = stdoutBuf.indexOf("\n"); nl !== -1; nl = stdoutBuf.indexOf("\n")) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1 && msg.result) {
          initialized = true;
          child.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
          );
          child.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n"
          );
        }
        if (msg.id === 2 && msg.result) {
          toolsList = msg.result.tools || [];
          finish({ initialized, tools: toolsList }, null);
        }
      }
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "margins-mcp-install-probe", version: "0.3.0" }
        }
      }) + "\n"
    );
  });
}
