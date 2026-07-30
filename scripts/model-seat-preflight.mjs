#!/usr/bin/env node
/** Validate canonical agent model seats and explain explicit consumer remapping. */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const strict = process.argv.includes("--strict");
const agentRoot = resolve(process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1]) ?? ".pi/agents");
const available = new Set((process.env.PI_HARNESS_AVAILABLE_MODELS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
let remap = {};
if (process.env.PI_HARNESS_MODEL_MAP) {
  try { remap = JSON.parse(process.env.PI_HARNESS_MODEL_MAP); } catch { fail("PI_HARNESS_MODEL_MAP must be valid JSON"); }
}

const seats = [];
for (const name of readdirSync(agentRoot).filter((name) => name.endsWith(".md")).sort()) {
  const text = readFileSync(resolve(agentRoot, name), "utf8");
  const match = text.match(/^model:\s*(\S+)\s*$/m);
  if (match) seats.push({ agent: name.slice(0, -3), seat: match[1] });
}
if (seats.length === 0) fail(`No model seats found in ${agentRoot}`);
const missing = seats.filter(({ seat }) => available.size > 0 && !available.has(remap[seat] ?? seat));
for (const { agent, seat } of seats) {
  const selected = remap[seat] ?? seat;
  console.log(`${agent}: ${seat}${selected === seat ? "" : ` → ${selected}`}`);
}
if (available.size === 0) {
  console.log("Model availability not probed: set PI_HARNESS_AVAILABLE_MODELS to the host's provider/model IDs for a strict check.");
  console.log("To remap explicitly, set PI_HARNESS_MODEL_MAP='{" + JSON.stringify(seats[0]?.seat ?? "provider/model") + ":\"provider/available-model\"}'.");
} else if (missing.length > 0) {
  console.error(`Unavailable model seats: ${missing.map(({ agent, seat }) => `${agent}=${seat}`).join(", ")}`);
  console.error("Remap explicitly with PI_HARNESS_MODEL_MAP JSON; silent fallback is not performed.");
  if (strict) process.exitCode = 1;
} else {
  console.log(`Model seat preflight passed (${seats.length} agents).`);
}

function fail(message) { console.error(`model-seat-preflight: ${message}`); process.exit(2); }
