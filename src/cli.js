import { mkdir, readFile, writeFile, readdir, copyFile, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { compileVault, vaultToFiles } from "./compiler.js";

const [inputDir = "sample/raw_sources", outputDir = "sample/output"] = process.argv.slice(2);

async function main() {
  const files = await readRawSources(inputDir);
  const vault = compileVault(files, { name: "Karpathy Original" });
  const generated = vaultToFiles(vault);

  await mkdir(outputDir, { recursive: true });
  await cleanGeneratedOutput(outputDir, generated);
  await copyRawSources(files, outputDir);
  for (const [path, body] of generated.entries()) {
    const outPath = join(outputDir, path);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, body, "utf8");
  }

  console.log(`Compiled ${files.length} source file${files.length === 1 ? "" : "s"} into ${outputDir}`);
  console.log(`Generated ${generated.size} operating/wiki files.`);
}

async function cleanGeneratedOutput(outputDir, generated) {
  const generatedPaths = new Set([".margins"]);
  for (const path of generated.keys()) {
    const target = cleanupTargetForGeneratedPath(path);
    if (target) generatedPaths.add(target);
  }

  for (const path of generatedPaths) {
    await rm(join(outputDir, path), { recursive: true, force: true });
  }
}

function cleanupTargetForGeneratedPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.startsWith("raw/") || normalized.startsWith("raw_sources/")) return "";
  const parts = normalized.split("/");
  if (parts[0] === "wiki" && parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  if (parts[0] === "commands" || parts[0] === "agents") return parts[0];
  return normalized;
}

async function readRawSources(dir) {
  const paths = await walk(dir);
  const files = [];
  for (const path of paths) {
    const name = relative(dir, path);
    let text = "";
    try {
      text = await readFile(path, "utf8");
    } catch {
      text = "";
    }
    files.push({ name, text, path });
  }
  return files;
}

async function copyRawSources(files, outputDir) {
  const rawDir = join(outputDir, "raw");
  await mkdir(rawDir, { recursive: true });
  for (const file of files) {
    const outPath = join(rawDir, file.name);
    await mkdir(dirname(outPath), { recursive: true });
    if (file.path) await copyFile(file.path, outPath);
    else await writeFile(outPath, file.text || "", "utf8");
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
