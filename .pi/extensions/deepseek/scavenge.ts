/**
 * Tool schema scavenging for DeepSeek compatibility
 *
 * Stolen from Reasonix (src/repair/scavenge.ts) — MIT License
 *
 * DeepSeek's function-calling backend is pickier than OpenAI's:
 * - Schemas >2 levels deep or >10 leaves → args dropped silently
 * - `$schema`, `default`, `examples` fields → 400 or silent drop
 * - `anyOf`/`oneOf` → frequently mis-parsed
 * - Large enums (>20 items) → 400
 * - `$ref` deep nesting → rejection
 *
 * This module "scavenges" (repairs in-place) tool specs to make them
 * DeepSeek-compatible.
 */

export interface SchemaAnalysis {
  shouldFlatten: boolean;
  leafCount: number;
  maxDepth: number;
  hasAnyOf: boolean;
  hasRef: boolean;
  enumTooLarge: boolean;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  enum?: unknown[];
  [k: string]: unknown;
}

/**
 * Analyze a JSON schema for DeepSeek compatibility issues.
 */
export function analyzeSchema(schema: JsonSchema | undefined): SchemaAnalysis {
  if (!schema) {
    return {
      shouldFlatten: false,
      leafCount: 0,
      maxDepth: 0,
      hasAnyOf: false,
      hasRef: false,
      enumTooLarge: false,
    };
  }

  let leafCount = 0;
  let maxDepth = 0;
  let hasAnyOf = false;
  let hasRef = false;
  let enumTooLarge = false;

  walk(schema, 0, (depth, isLeaf, node) => {
    if (isLeaf) leafCount++;
    if (depth > maxDepth) maxDepth = depth;
    if (node.anyOf || node.oneOf) hasAnyOf = true;
    if (node.$ref) hasRef = true;
    if (Array.isArray(node.enum) && node.enum.length > 20) enumTooLarge = true;
  });

  return {
    shouldFlatten: leafCount > 10 || maxDepth > 2,
    leafCount,
    maxDepth,
    hasAnyOf,
    hasRef,
    enumTooLarge,
  };
}

/**
 * Deep-clean a tool schema for DeepSeek compat:
 * - Removes `$schema`, `default`, `examples`, `deprecated`
 * - Converts `anyOf`/`oneOf` to `{ type: "string" }` (DeepSeek can't handle them)
 * - Caps enums to 20 items
 * - Replaces deeply nested `$ref` with string type
 * - Strips `title`, `readOnly`, `writeOnly`
 */
export function repairSchema(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== "object") return schema ?? { type: "string" };

  const out: JsonSchema = {};

  for (const [key, value] of Object.entries(schema)) {
    // Drop fields DeepSeek can't handle
    if (key === "$schema") continue;
    if (key === "default") continue;
    if (key === "examples") continue;
    if (key === "deprecated") continue;
    if (key === "title") continue;
    if (key === "readOnly") continue;
    if (key === "writeOnly") continue;

    // Convert anyOf/oneOf to string (DeepSeek frequently mis-parses these)
    if (key === "anyOf" || key === "oneOf") {
      // Try to extract a common type from the variants
      out.type = "string";
      continue;
    }

    // Cap enums
    if (key === "enum" && Array.isArray(value) && value.length > 20) {
      out.enum = value.slice(0, 20);
      continue;
    }

    // Resolve $ref to string type
    if (key === "$ref") {
      out.type = "string";
      out.description = `resolved from ${value}`;
      continue;
    }

    // Recurse into properties
    if (key === "properties" && typeof value === "object" && value !== null) {
      const repairedProps: Record<string, JsonSchema> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, JsonSchema>)) {
        repairedProps[propName] = repairSchema(propSchema);
      }
      out.properties = repairedProps;
      continue;
    }

    // Recurse into items (arrays)
    if (key === "items" && typeof value === "object" && value !== null) {
      out.items = repairSchema(value as JsonSchema);
      continue;
    }

    // Pass through safe fields
    out[key] = value;
  }

  return out;
}

export interface ToolSpec {
  type?: string;
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/**
 * Apply repairSchema to all tool specs, and return scavenge stats.
 */
export function scavengeToolSpecs(
  tools: ToolSpec[] | undefined,
): { tools: ToolSpec[]; schemasRepaired: number; issuesFound: SchemaAnalysis } {
  if (!tools || tools.length === 0) {
    return { tools: tools ?? [], schemasRepaired: 0, issuesFound: emptyAnalysis() };
  }

  let schemasRepaired = 0;
  let worstAnalysis: SchemaAnalysis = emptyAnalysis();

  const repaired = tools.map((tool) => {
    const analysis = analyzeSchema(tool.function?.parameters);
    if (analysis.leafCount > worstAnalysis.leafCount) worstAnalysis = analysis;
    if (analysis.maxDepth > worstAnalysis.maxDepth) worstAnalysis = analysis;
    if (analysis.hasAnyOf) worstAnalysis.hasAnyOf = true;
    if (analysis.hasRef) worstAnalysis.hasRef = true;
    if (analysis.enumTooLarge) worstAnalysis.enumTooLarge = true;

    if (
      analysis.hasAnyOf ||
      analysis.hasRef ||
      analysis.enumTooLarge ||
      analysis.shouldFlatten
    ) {
      schemasRepaired++;
      return {
        ...tool,
        function: {
          ...tool.function,
          parameters: repairSchema(tool.function.parameters),
        },
      };
    }

    return tool;
  });

  return {
    tools: repaired,
    schemasRepaired,
    issuesFound: worstAnalysis,
  };
}

function emptyAnalysis(): SchemaAnalysis {
  return {
    shouldFlatten: false,
    leafCount: 0,
    maxDepth: 0,
    hasAnyOf: false,
    hasRef: false,
    enumTooLarge: false,
  };
}

function walk(
  schema: JsonSchema,
  depth: number,
  visit: (depth: number, isLeaf: boolean, node: JsonSchema) => void,
): void {
  if (schema.type === "object" && schema.properties) {
    for (const child of Object.values(schema.properties)) {
      walk(child, depth + 1, visit);
    }
    return;
  }
  if (schema.type === "array" && schema.items) {
    walk(schema.items, depth + 1, visit);
    return;
  }
  visit(depth, true, schema);
}
