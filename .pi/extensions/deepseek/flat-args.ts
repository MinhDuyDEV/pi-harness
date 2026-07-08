/**
 * Schema flattening for DeepSeek tool calls
 *
 * Stolen from Reasonix (src/repair/flatten.ts) — MIT License
 *
 * DeepSeek drops args on schemas >2 levels deep or >10 leaves.
 * This module analyzes schemas, flattens them to dot-path flat schemas
 * before sending, and re-nests arguments on receipt.
 *
 * This is P3 priority — only needed if you have tools with deeply nested
 * or large schemas. Most pikit tools are shallow.
 */

import type { JsonSchema } from "./scavenge.js";

export interface FlattenDecision {
  shouldFlatten: boolean;
  leafCount: number;
  maxDepth: number;
}

/**
 * Analyze a schema to determine if flattening is needed.
 */
export function analyzeSchema(schema: JsonSchema | undefined): FlattenDecision {
  if (!schema || schema.type !== "object") {
    return { shouldFlatten: false, leafCount: 0, maxDepth: 0 };
  }

  let leafCount = 0;
  let maxDepth = 0;

  walkSchema(schema, 0, (depth, isLeaf) => {
    if (isLeaf) leafCount++;
    if (depth > maxDepth) maxDepth = depth;
  });

  return {
    // Actually flatten only when >15 leaves or >3 depth (slightly more lenient than Reasonix)
    shouldFlatten: leafCount > 15 || maxDepth > 3,
    leafCount,
    maxDepth,
  };
}

/**
 * Flatten a nested object schema to dot-path flat schema.
 *
 * Input:  { type: "object", properties: { a: { type: "object", properties: { b: { type: "string" } } } } }
 * Output: { type: "object", properties: { "a.b": { type: "string" } } }
 */
export function flattenSchema(schema: JsonSchema): JsonSchema {
  if (!schema || schema.type !== "object") {
    return schema;
  }

  const flatProps: Record<string, JsonSchema> = {};
  const required: string[] = [];

  collect("", schema, flatProps, required, true);

  return {
    type: "object",
    properties: flatProps,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Convert flat dot-path arguments back to nested structure after receiving tool call args.
 *
 * Input:  { "a.b": "value" }
 * Output: { a: { b: "value" } }
 */
export function nestArguments(flatArgs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flatArgs)) {
    setByPath(out, key.split("."), value);
  }

  return out;
}

function walkSchema(
  schema: JsonSchema,
  depth: number,
  visit: (depth: number, isLeaf: boolean) => void,
): void {
  if (schema.type === "object" && schema.properties) {
    for (const child of Object.values(schema.properties)) {
      walkSchema(child, depth + 1, visit);
    }
    return;
  }
  if (schema.type === "array" && schema.items) {
    walkSchema(schema.items, depth + 1, visit);
    return;
  }
  visit(depth, true);
}

function collect(
  prefix: string,
  schema: JsonSchema,
  out: Record<string, JsonSchema>,
  requiredList: string[],
  isRootRequired: boolean,
): void {
  if (schema.type === "object" && schema.properties) {
    const requiredSet = new Set(schema.required ?? []);
    for (const [key, child] of Object.entries(schema.properties)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      const childRequired = isRootRequired && requiredSet.has(key);
      collect(nextPrefix, child, out, requiredList, childRequired);
    }
    return;
  }

  // Treat anything non-object (including arrays) as a leaf for flattening purposes
  out[prefix] = schema;
  if (isRootRequired) requiredList.push(prefix);
}

function setByPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[path[path.length - 1]!] = value;
}
