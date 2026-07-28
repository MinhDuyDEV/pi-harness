import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, posix } from "node:path";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function currentText(path, conflicts, consumerPath) {
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile()) {
    conflicts.push(`${consumerPath}: expected a regular file`);
    return undefined;
  }
  return readFileSync(path, "utf8");
}

function isLegacyPortableAgent(consumerPath, current, desired) {
  if (!consumerPath.startsWith(".pi/agents/")) return false;
  return current.replace(/^(?:provider|model):[^\n]*\n/gm, "") === desired;
}

export function planManagedFile(plans, conflicts, lock, targetRoot, consumerPath, desired) {
  const path = join(targetRoot, consumerPath);
  const current = currentText(path, conflicts, consumerPath);
  if (current === undefined) return;
  const baseline = lock?.files?.[consumerPath]?.sha256;
  if (current === desired) return;
  if (
    current === null ||
    (typeof baseline === "string" && sha256(current) === baseline) ||
    (!baseline && isLegacyPortableAgent(consumerPath, current, desired))
  ) {
    plans.push({ consumerPath, path, content: desired, operation: current === null ? "create" : "update" });
    return;
  }
  conflicts.push(`${consumerPath}: consumer content differs from its recorded harness baseline`);
}

function parseManagedRegion(current, startMarker, endMarker, consumerPath, conflicts) {
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);
  if (start === -1 && end === -1) return null;
  if (
    start === -1 ||
    end === -1 ||
    end < start ||
    current.indexOf(startMarker, start + 1) !== -1 ||
    current.indexOf(endMarker, end + 1) !== -1
  ) {
    conflicts.push(`${consumerPath}: malformed managed sentinel region`);
    return undefined;
  }
  const bodyStart = start + startMarker.length;
  let body = current.slice(bodyStart, end);
  if (body.startsWith("\n")) body = body.slice(1);
  if (body.endsWith("\n")) body = body.slice(0, -1);
  return { start, end: end + endMarker.length, body };
}

function appendRegion(current, startMarker, body, endMarker) {
  const prefix = current.length === 0 ? "" : `${current.replace(/\s*$/, "")}\n\n`;
  return `${prefix}${startMarker}\n${body}\n${endMarker}\n`;
}

function replaceRegion(current, region, startMarker, body, endMarker) {
  return `${current.slice(0, region.start)}${startMarker}\n${body}\n${endMarker}${current.slice(region.end)}`;
}

export function planManagedRegion({
  plans,
  conflicts,
  lock,
  targetRoot,
  consumerPath,
  lockKey,
  startMarker,
  endMarker,
  desiredBody,
}) {
  const path = join(targetRoot, consumerPath);
  const current = currentText(path, conflicts, consumerPath);
  if (current === undefined) return;
  if (current === null) {
    plans.push({ consumerPath, path, content: appendRegion("", startMarker, desiredBody, endMarker), operation: "create" });
    return;
  }
  const region = parseManagedRegion(current, startMarker, endMarker, consumerPath, conflicts);
  if (region === undefined) return;
  if (region === null) {
    plans.push({ consumerPath, path, content: appendRegion(current, startMarker, desiredBody, endMarker), operation: "update" });
    return;
  }
  if (region.body === desiredBody) return;
  const baseline = lock?.files?.[lockKey]?.sha256;
  if (typeof baseline === "string" && sha256(region.body) === baseline) {
    plans.push({
      consumerPath,
      path,
      content: replaceRegion(current, region, startMarker, desiredBody, endMarker),
      operation: "update",
    });
    return;
  }
  conflicts.push(`${consumerPath}: managed region differs from its recorded harness baseline`);
}

export function planStaleManagedDeletes(plans, conflicts, lock, targetRoot, desiredKeys) {
  if (!lock) return;
  for (const [consumerPath, record] of Object.entries(lock.files)) {
    if (desiredKeys.has(consumerPath) || consumerPath.includes("#")) continue;
    if (!consumerPath.startsWith(".pi/agents/") && !consumerPath.startsWith(".pi/templates/")) continue;
    if (consumerPath.includes("\\") || posix.normalize(consumerPath) !== consumerPath) {
      conflicts.push(`${consumerPath}: invalid managed path in ownership lock`);
      continue;
    }
    const path = join(targetRoot, consumerPath);
    if (!existsSync(path)) continue;
    const current = currentText(path, conflicts, consumerPath);
    if (current === undefined) continue;
    if (typeof record?.sha256 === "string" && sha256(current) === record.sha256) {
      plans.push({ consumerPath, path, operation: "delete" });
    } else {
      conflicts.push(`${consumerPath}: obsolete managed file has consumer changes and was not deleted`);
    }
  }
}

export function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
