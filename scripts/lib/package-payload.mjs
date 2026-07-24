/**
 * Normalize npm pack paths and validate the publish payload contract.
 */

/** @param {string} path */
export function normalizePackPath(path) {
  return path.startsWith("package/") ? path.slice("package/".length) : path;
}

export const defaultPayloadContract = {
  requiredExact: [
    "package.json",
    "README.md",
    "AGENTS.md",
    "skills-lock.json",
    ".pi/settings.json",
    "scripts/lib/package-payload.mjs",
    "scripts/lib/prompt-policy.mjs",
    "scripts/lib/resource-smoke.mjs",
    "scripts/release-check.mjs",
    "scripts/smoke-packed-resources.mjs",
    "scripts/smoke-resources.mjs",
    "scripts/validate-package-payload.mjs",
    "scripts/validate-package.mjs",
    "scripts/validate-skills.mjs",
  ],
  requiredPatterns: [
    { re: /^\.pi\/skills\/[^/]+\/SKILL\.md$/, label: "skill SKILL.md" },
    { re: /^\.pi\/prompts\/[^/]+\.md$/, label: "prompt" },
    { re: /^\.pi\/agents\/[^/]+\.md$/, label: "agent" },
    { re: /^\.pi\/extensions\//, label: "extension resource" },
    { re: /^\.pi\/themes\/[^/]+\.json$/, label: "theme" },
    { re: /^scripts\//, label: "release script" },
  ],
  forbidden: [
    /^\.pi\/artifacts\//,
    /^\.pi\/MEMORY\.md$/,
    /^\.pi\/npm\//,
    /(^|\/)\.env(\.[^/]+)?$/,
    /(^|\/)credentials\.(json|ya?ml|txt)$/,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /(^|\/)id_rsa$/,
    /^node_modules\//,
    /^\.git\//,
    /\.tgz$/,
    /(^|\/)\.cache\//,
    /(^|\/)coverage\//,
    /\.DS_Store$/,
    /\.log$/,
    /\.test\.ts$/,
    /\.test\.js$/,
    /\.test\.d\.ts$/,
    /^\.pi\/extensions\/rewind\/(PORT|TESTING)\.md$/,
  ],
};

/**
 * @param {string[]} paths
 * @param {typeof defaultPayloadContract} [contract]
 */
export function validatePackagePayload(paths, contract = defaultPayloadContract) {
  const normalized = paths.map(normalizePackPath);
  const errors = [];

  for (const exact of contract.requiredExact) {
    if (!normalized.includes(exact)) errors.push(`missing required file: ${exact}`);
  }
  for (const { re, label } of contract.requiredPatterns) {
    if (!normalized.some((path) => re.test(path))) {
      errors.push(`missing required ${label}: no packed path matched ${re}`);
    }
  }
  for (const pattern of contract.forbidden) {
    for (const path of normalized) {
      if (pattern.test(path)) errors.push(`forbidden file in payload: ${path} (matched ${pattern})`);
    }
  }

  return { errors };
}
