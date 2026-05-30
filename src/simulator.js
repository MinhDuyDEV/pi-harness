/** Deterministic hash from a string. */
function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Deterministic pseudo-random number generator (mulberry32). */
function createRng(seed) {
  let s = seed | 0;
  return {
    next() {
      s |= 0;
      s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    },
    nextInt(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
  };
}

const PHASES = {
  planner: {
    phase: 'planner',
    type: 'planning',
    messages: [
      'mapped requirements into acceptance checks',
      'identified project constraints and data boundaries',
      'produced a scoped implementation plan',
    ],
    artifacts: [
      ['plan.md', 'markdown', '# Implementation Plan\n\n- Confirm local-first storage\n- Build CRUD surfaces\n- Simulate planner/worker/reviewer events\n- Verify accessibility and data logic'],
      ['risk-register.md', 'markdown', '# Risk Register\n\n| Risk | Mitigation |\n| --- | --- |\n| Data loss | Browser-local persistence with clear save points |\n| Scope creep | No backend, auth, or real LLM calls |'],
    ],
  },
  worker: {
    phase: 'worker',
    type: 'execution',
    messages: [
      'implemented the smallest working slice',
      'generated artifacts for inspection',
      'updated tests for core state transitions',
    ],
    artifacts: [
      ['diff.patch', 'code', 'diff --git a/src/workbench.js b/src/workbench.js\n+ export function launchRun(config) {\n+   return simulate(config);\n+ }'],
      ['state-notes.md', 'markdown', '# State Notes\n\nRuns reference projects and one or more agent profiles. Artifacts are persisted with the run.'],
      ['test-output.txt', 'text', 'node --test\n✔ core state logic\n✔ deterministic run simulation\n✔ run search filters'],
    ],
  },
  reviewer: {
    phase: 'reviewer',
    type: 'review',
    messages: [
      'checked acceptance criteria against generated artifacts',
      'verified keyboard and labeled-control requirements',
      'recorded pass/fail decision with findings',
    ],
    artifacts: [
      ['review.md', 'markdown', '# Review\n\n## Findings\n- CRUD paths are local-only\n- Run timeline has labeled phase events\n- Status is shown with text, not color alone'],
      ['qa-report.md', 'markdown', '# QA Report\n\nResult: PASS\n\nEvidence: deterministic simulator output and unit tests.'],
    ],
  },
};

const ROLE_ORDER = { planner: 0, worker: 1, reviewer: 2 };

function phaseForRole(role) {
  return PHASES[role] ?? PHASES.worker;
}

function costRateFor(profile) {
  const model = String(profile.model ?? '').toLowerCase();
  if (model.includes('mini') || model.includes('haiku')) return 0.00001;
  if (model.includes('pro') || model.includes('opus')) return 0.00005;
  return 0.00003;
}

/**
 * Generate a deterministic simulation result for a Run.
 *
 * @param {object} project Project object with id/name.
 * @param {Array<object>} profiles Agent profile objects with id/name/role/model.
 * @returns {object} events, artifacts, token/cost summaries, perAgentUsage, passed.
 */
export function simulateRun(project, profiles) {
  const sortedProfiles = [...profiles].sort((a, b) => {
    const roleDelta = (ROLE_ORDER[a.role] ?? 1) - (ROLE_ORDER[b.role] ?? 1);
    return roleDelta || String(a.name).localeCompare(String(b.name));
  });
  const seedStr = `${project.id}:${project.name}::${sortedProfiles.map((p) => `${p.id}:${p.name}:${p.role}:${p.model}:${p.thinkingLevel}`).join('|')}`;
  const rng = createRng(hashStr(seedStr));

  const events = [];
  const artifacts = [];
  const perAgentUsage = [];
  const tokenSummary = { total: 0, planning: 0, execution: 0, review: 0 };
  let totalCost = 0;

  sortedProfiles.forEach((profile, profileIndex) => {
    const phase = phaseForRole(profile.role);
    const promptTokens = rng.nextInt(450, 2600);
    const completionTokens = rng.nextInt(180, 1400);
    const totalTokens = promptTokens + completionTokens;
    const cost = Math.round(totalTokens * costRateFor(profile) * 10000) / 10000;

    tokenSummary.total += totalTokens;
    if (phase.phase === 'planner') tokenSummary.planning += totalTokens;
    if (phase.phase === 'worker') tokenSummary.execution += totalTokens;
    if (phase.phase === 'reviewer') tokenSummary.review += totalTokens;
    totalCost += cost;

    perAgentUsage.push({
      agentId: profile.id,
      agentName: profile.name,
      role: profile.role,
      model: profile.model,
      promptTokens,
      completionTokens,
      totalTokens,
      cost,
    });

    const message = phase.messages[rng.nextInt(0, phase.messages.length - 1)];
    const durationMs = rng.nextInt(300, 2400);
    events.push({
      id: `event-${profileIndex + 1}`,
      agentId: profile.id,
      agentName: profile.name,
      agent: profile.name,
      role: profile.role,
      type: phase.type,
      phase: phase.phase,
      content: `${profile.name} ${message}.`,
      durationMs,
      duration: durationMs,
    });

    const artifactCount = rng.nextInt(1, phase.artifacts.length);
    for (let i = 0; i < artifactCount; i += 1) {
      const artifact = phase.artifacts[(i + rng.nextInt(0, phase.artifacts.length - 1)) % phase.artifacts.length];
      artifacts.push({
        id: `artifact-${profileIndex + 1}-${i + 1}`,
        name: `${profile.role}-${artifact[0]}`,
        type: artifact[1],
        agentName: profile.name,
        content: artifact[2],
      });
    }
  });

  const passed = hashStr(seedStr) % 7 !== 0;

  return {
    events,
    artifacts,
    tokenSummary,
    costSummary: { total: Math.round(totalCost * 10000) / 10000, currency: 'USD' },
    perAgentUsage,
    passed,
  };
}
