import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const sourcePath = path.join(repoRoot, ".pi", "templates", "behavioral-kernel.md");
const targets = [
  path.join(repoRoot, ".pi", "SYSTEM.md"),
  path.join(repoRoot, ".pi", "AGENTS.md"),
  path.join(repoRoot, ".pi", "templates", "AGENTS.md"),
];

const startMarker = "<!-- behavioral-kernel:start -->";
const endMarker = "<!-- behavioral-kernel:end -->";
const checkOnly = process.argv.includes("--check");

function replaceBetweenMarkers(content, replacement) {
  const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, "m");

  if (!pattern.test(content)) {
    throw new Error(`Missing behavioral-kernel markers`);
  }

  return content.replace(pattern, `${startMarker}\n${replacement.trim()}\n${endMarker}`);
}

async function main() {
  const source = await readFile(sourcePath, "utf8");
  const mismatches = [];

  for (const targetPath of targets) {
    const current = await readFile(targetPath, "utf8");
    const next = replaceBetweenMarkers(current, source);

    if (current !== next) {
      if (checkOnly) {
        mismatches.push(path.relative(repoRoot, targetPath));
      } else {
        await writeFile(targetPath, next);
        console.log(`synced ${path.relative(repoRoot, targetPath)}`);
      }
    } else if (!checkOnly) {
      console.log(`ok ${path.relative(repoRoot, targetPath)}`);
    }
  }

  if (checkOnly && mismatches.length > 0) {
    console.error("behavioral kernel out of sync:");
    for (const file of mismatches) console.error(`- ${file}`);
    process.exitCode = 1;
    return;
  }

  if (checkOnly) {
    console.log("behavioral kernel is in sync");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
