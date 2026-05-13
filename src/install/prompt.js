import readline from "node:readline";

export function createPrompter({ stdin = process.stdin, stdout = process.stdout, yes = false } = {}) {
  let rl = null;
  function ensure() {
    if (!rl) rl = readline.createInterface({ input: stdin, output: stdout });
    return rl;
  }
  async function ask(question, { defaultYes = true } = {}) {
    if (yes) return defaultYes;
    return new Promise((resolve) => {
      const suffix = defaultYes ? " [Y/n]: " : " [y/N]: ";
      ensure().question(question + suffix, (answer) => {
        const trimmed = answer.trim().toLowerCase();
        if (!trimmed) return resolve(defaultYes);
        resolve(trimmed === "y" || trimmed === "yes");
      });
    });
  }
  async function askText(question, { defaultValue = "" } = {}) {
    if (yes) return defaultValue;
    return new Promise((resolve) => {
      const suffix = defaultValue ? ` [${defaultValue}]: ` : ": ";
      ensure().question(question + suffix, (answer) => {
        const trimmed = answer.trim();
        resolve(trimmed || defaultValue);
      });
    });
  }
  function close() {
    if (rl) {
      rl.close();
      rl = null;
    }
  }
  return { ask, askText, close };
}
