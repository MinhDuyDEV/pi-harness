function generateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function now() {
  return Date.now();
}

function cloneRun(run) {
  return {
    ...run,
    agentProfileIds: [...run.agentProfileIds],
    events: run.events.map((event) => ({ ...event })),
    artifacts: run.artifacts.map((artifact) => ({ ...artifact })),
    tokenSummary: { ...run.tokenSummary },
    costSummary: { ...run.costSummary },
    perAgentUsage: (run.perAgentUsage ?? []).map((usage) => ({ ...usage })),
  };
}

function cloneAgentProfile(profile) {
  return {
    ...profile,
    allowedTools: [...profile.allowedTools],
  };
}

class Store {
  constructor() {
    this.projects = new Map();
    this.agentProfiles = new Map();
    this.runs = new Map();
  }

  createProject(data) {
    const project = {
      id: generateId(),
      name: data.name,
      description: data.description ?? '',
      createdAt: now(),
      updatedAt: now(),
    };
    this.projects.set(project.id, project);
    return { ...project };
  }

  getProject(id) {
    const project = this.projects.get(id);
    return project ? { ...project } : undefined;
  }

  updateProject(id, data) {
    const project = this.projects.get(id);
    if (!project) return undefined;
    Object.assign(project, data, { updatedAt: now() });
    return { ...project };
  }

  deleteProject(id) {
    return this.projects.delete(id);
  }

  listProjects() {
    return Array.from(this.projects.values()).map((project) => ({ ...project }));
  }

  createAgentProfile(data) {
    const profile = {
      id: generateId(),
      name: data.name,
      role: data.role ?? 'worker',
      model: data.model ?? '',
      thinkingLevel: data.thinkingLevel ?? 'medium',
      allowedTools: [...(data.allowedTools ?? [])],
      systemPrompt: data.systemPrompt ?? '',
      createdAt: now(),
      updatedAt: now(),
    };
    this.agentProfiles.set(profile.id, profile);
    return cloneAgentProfile(profile);
  }

  getAgentProfile(id) {
    const profile = this.agentProfiles.get(id);
    return profile ? cloneAgentProfile(profile) : undefined;
  }

  updateAgentProfile(id, data) {
    const profile = this.agentProfiles.get(id);
    if (!profile) return undefined;
    Object.assign(profile, data, {
      allowedTools: data.allowedTools ? [...data.allowedTools] : profile.allowedTools,
      updatedAt: now(),
    });
    return cloneAgentProfile(profile);
  }

  deleteAgentProfile(id) {
    return this.agentProfiles.delete(id);
  }

  listAgentProfiles() {
    return Array.from(this.agentProfiles.values()).map(cloneAgentProfile);
  }

  createRun(data) {
    const run = {
      id: generateId(),
      projectId: data.projectId,
      agentProfileIds: [...data.agentProfileIds],
      status: data.status ?? 'pending',
      events: data.events ?? [],
      artifacts: data.artifacts ?? [],
      tokenSummary: data.tokenSummary ?? { total: 0, planning: 0, execution: 0, review: 0 },
      costSummary: data.costSummary ?? { total: 0, currency: 'USD' },
      perAgentUsage: data.perAgentUsage ?? [],
      passed: data.passed ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.runs.set(run.id, run);
    return cloneRun(run);
  }

  getRun(id) {
    const run = this.runs.get(id);
    return run ? cloneRun(run) : undefined;
  }

  updateRun(id, data) {
    const run = this.runs.get(id);
    if (!run) return undefined;
    Object.assign(run, data, {
      agentProfileIds: data.agentProfileIds ? [...data.agentProfileIds] : run.agentProfileIds,
      updatedAt: now(),
    });
    return cloneRun(run);
  }

  deleteRun(id) {
    return this.runs.delete(id);
  }

  listRuns() {
    return Array.from(this.runs.values()).map(cloneRun);
  }
}

const defaultStore = new Store();

export { Store, defaultStore as store };
export default defaultStore;
