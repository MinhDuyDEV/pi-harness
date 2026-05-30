import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../src/storage.js';
import { simulateRun } from '../src/simulator.js';
import { searchRuns } from '../src/state.js';

// ──────────────────────────────────────────────
// Projects CRUD
// ──────────────────────────────────────────────

describe('Projects — CRUD', () => {
  let store;

  before(() => { store = new Store(); });

  it('creates a Project and retrieves it by id', () => {
    const project = store.createProject({ name: 'Test Project', description: 'A test project' });

    assert.ok(project.id);
    assert.equal(project.name, 'Test Project');
    assert.equal(project.description, 'A test project');
    assert.ok(project.createdAt);
    assert.ok(project.updatedAt);

    const retrieved = store.getProject(project.id);
    assert.deepEqual(retrieved, project);
  });

  it('updates a Project', () => {
    const project = store.createProject({ name: 'Old Name' });
    const updated = store.updateProject(project.id, { name: 'New Name' });

    assert.equal(updated.name, 'New Name');
    assert.ok(updated.updatedAt >= project.updatedAt);
    assert.equal(updated.description, project.description);
  });

  it('deletes a Project', () => {
    const project = store.createProject({ name: 'To Delete' });
    assert.ok(store.getProject(project.id));

    const deleted = store.deleteProject(project.id);
    assert.equal(deleted, true);
    assert.equal(store.getProject(project.id), undefined);
  });

  it('lists all Projects', () => {
    store.createProject({ name: 'A' });
    store.createProject({ name: 'B' });
    const list = store.listProjects();
    assert.ok(list.length >= 2);
    assert.ok(list.every(p => p.id && p.name));
  });

  it('returns undefined for non-existent project', () => {
    assert.equal(store.getProject('non-existent'), undefined);
  });

  it('returns undefined when updating non-existent project', () => {
    assert.equal(store.updateProject('non-existent', { name: 'x' }), undefined);
  });
});

// ──────────────────────────────────────────────
// Agent Profiles CRUD
// ──────────────────────────────────────────────

describe('Agent Profiles — CRUD', () => {
  let store;

  before(() => { store = new Store(); });

  it('creates an Agent Profile and retrieves it by id', () => {
    const profile = store.createAgentProfile({
      name: 'Planner Alpha',
      role: 'planner',
      model: 'claude-opus-4',
    });

    assert.ok(profile.id);
    assert.equal(profile.name, 'Planner Alpha');
    assert.equal(profile.role, 'planner');
    assert.equal(profile.model, 'claude-opus-4');
    assert.ok(profile.createdAt);
    assert.ok(profile.updatedAt);

    const retrieved = store.getAgentProfile(profile.id);
    assert.deepEqual(retrieved, profile);
  });

  it('updates an Agent Profile', () => {
    const profile = store.createAgentProfile({ name: 'Bot', role: 'worker', model: 'gpt-4' });
    const updated = store.updateAgentProfile(profile.id, { name: 'Super Bot', model: 'gpt-5' });

    assert.equal(updated.name, 'Super Bot');
    assert.equal(updated.model, 'gpt-5');
    assert.equal(updated.role, 'worker'); // unchanged
    assert.ok(updated.updatedAt >= profile.updatedAt);
  });

  it('deletes an Agent Profile', () => {
    const profile = store.createAgentProfile({ name: 'To Delete', role: 'reviewer' });
    store.deleteAgentProfile(profile.id);
    assert.equal(store.getAgentProfile(profile.id), undefined);
  });

  it('lists all Agent Profiles', () => {
    store.createAgentProfile({ name: 'A', role: 'planner' });
    store.createAgentProfile({ name: 'B', role: 'worker' });
    const list = store.listAgentProfiles();
    assert.ok(list.length >= 2);
    assert.ok(list.every(p => p.id && p.name && p.role));
  });

  it('returns undefined for non-existent profile', () => {
    assert.equal(store.getAgentProfile('nope'), undefined);
  });
});

// ──────────────────────────────────────────────
// Runs — creation and relationships
// ──────────────────────────────────────────────

describe('Runs — creation', () => {
  let store, project, planner, worker, reviewer;

  before(() => {
    store = new Store();
    project = store.createProject({ name: 'Run Test Project' });
    planner = store.createAgentProfile({ name: 'PlanBot', role: 'planner', model: 'claude' });
    worker = store.createAgentProfile({ name: 'WorkBot', role: 'worker', model: 'gpt-4' });
    reviewer = store.createAgentProfile({ name: 'ReviewBot', role: 'reviewer', model: 'claude' });
  });

  it('creates a Run belonging to a Project and referencing Agent Profiles', () => {
    const run = store.createRun({
      projectId: project.id,
      agentProfileIds: [planner.id, worker.id, reviewer.id],
    });

    assert.ok(run.id);
    assert.equal(run.projectId, project.id);
    assert.deepEqual(run.agentProfileIds, [planner.id, worker.id, reviewer.id]);
    assert.equal(run.status, 'pending');
    assert.deepEqual(run.events, []);
    assert.deepEqual(run.artifacts, []);
    assert.deepEqual(run.tokenSummary, { total: 0, planning: 0, execution: 0, review: 0 });
    assert.deepEqual(run.costSummary, { total: 0, currency: 'USD' });
    assert.equal(run.passed, null);
  });

  it('updates a Run status', () => {
    const run = store.createRun({ projectId: project.id, agentProfileIds: [worker.id] });
    const updated = store.updateRun(run.id, { status: 'running' });

    assert.equal(updated.status, 'running');
  });

  it('deletes a Run', () => {
    const run = store.createRun({ projectId: project.id, agentProfileIds: [worker.id] });
    store.deleteRun(run.id);
    assert.equal(store.getRun(run.id), undefined);
  });

  it('lists Runs', () => {
    store.createRun({ projectId: project.id, agentProfileIds: [planner.id] });
    store.createRun({ projectId: project.id, agentProfileIds: [worker.id] });
    const runs = store.listRuns();
    assert.ok(runs.length >= 2);
  });

  it('creates Run explicitly with status and passed fields', () => {
    const run = store.createRun({
      projectId: project.id,
      agentProfileIds: [planner.id],
      status: 'completed',
      passed: true,
    });
    assert.equal(run.status, 'completed');
    assert.equal(run.passed, true);
  });
});

// ──────────────────────────────────────────────
// Run Simulator — deterministic behavior
// ──────────────────────────────────────────────

describe('Run Simulator — deterministic output', () => {
  let store, project, planner, worker, reviewer;

  before(() => {
    store = new Store();
    project = store.createProject({ name: 'Sim Project' });
    planner = store.createAgentProfile({ name: 'Alice', role: 'planner', model: 'claude-opus-4' });
    worker = store.createAgentProfile({ name: 'Bob', role: 'worker', model: 'gpt-4o' });
    reviewer = store.createAgentProfile({ name: 'Carol', role: 'reviewer', model: 'claude-sonnet-4' });
  });

  it('simulateRun returns deterministic events, artifacts, tokens, cost, and pass/fail', () => {
    const profiles = [planner, worker, reviewer];
    const result = simulateRun(project, profiles);

    // Events
    assert.ok(Array.isArray(result.events));
    assert.equal(result.events.length, 3);
    assert.equal(result.events[0].role, 'planner');
    assert.equal(result.events[1].role, 'worker');
    assert.equal(result.events[2].role, 'reviewer');
    assert.ok(result.events.every(e => e.agent && e.type && e.content && e.duration > 0));

    // Artifacts
    assert.ok(Array.isArray(result.artifacts));
    assert.ok(result.artifacts.length > 0);
    assert.ok(result.artifacts.every(a => a.name && a.type && a.content));

    // Token summary
    assert.ok(result.tokenSummary);
    assert.equal(typeof result.tokenSummary.total, 'number');
    assert.ok(result.tokenSummary.total > 0);
    assert.ok(result.tokenSummary.planning > 0);
    assert.ok(result.tokenSummary.execution > 0);
    assert.ok(result.tokenSummary.review > 0);

    // Cost summary
    assert.ok(result.costSummary);
    assert.ok(result.costSummary.total > 0);
    assert.equal(result.costSummary.currency, 'USD');

    // Pass/fail
    assert.equal(typeof result.passed, 'boolean');
  });

  it('simulateRun is deterministic — same inputs produce same result', () => {
    const profiles = [planner, worker, reviewer];
    const result1 = simulateRun(project, profiles);
    const result2 = simulateRun(project, profiles);

    assert.deepEqual(result1, result2);
  });

  it('different projects produce different simulation results', () => {
    const project2 = store.createProject({ name: 'Another Project' });
    const profiles = [planner, worker, reviewer];
    const result1 = simulateRun(project, profiles);
    const result2 = simulateRun(project2, profiles);

    assert.notDeepEqual(result1, result2);
  });

  it('simulateRun works with only a planner and worker (no reviewer)', () => {
    const profiles = [planner, worker];
    const result = simulateRun(project, profiles);

    assert.equal(result.events.length, 2);
    assert.equal(result.events[0].role, 'planner');
    assert.equal(result.events[1].role, 'worker');
    assert.ok(result.tokenSummary.total > 0);
  });
});

// ──────────────────────────────────────────────
// Run filtering / search
// ──────────────────────────────────────────────

describe('Run search and filtering', () => {
  let store, projectA, projectB, planner, worker, reviewer;
  let runPending, runCompleted, runFailed;

  before(() => {
    store = new Store();
    projectA = store.createProject({ name: 'Alpha' });
    projectB = store.createProject({ name: 'Beta' });
    planner = store.createAgentProfile({ name: 'Alice', role: 'planner', model: 'claude' });
    worker = store.createAgentProfile({ name: 'Bob', role: 'worker', model: 'gpt-4' });
    reviewer = store.createAgentProfile({ name: 'Carol', role: 'reviewer', model: 'claude' });

    // Create runs with different projects, statuses, and agent profiles
    runPending = store.createRun({
      projectId: projectA.id,
      agentProfileIds: [planner.id],
      status: 'pending',
      events: [
        { agent: 'Alice', role: 'planner', type: 'planning', content: 'planning phase', duration: 100 },
      ],
      tokenSummary: { total: 500, planning: 500, execution: 0, review: 0 },
      costSummary: { total: 0.01, currency: 'USD' },
      passed: null,
    });

    runCompleted = store.createRun({
      projectId: projectA.id,
      agentProfileIds: [planner.id, worker.id, reviewer.id],
      status: 'completed',
      events: [
        { agent: 'Alice', role: 'planner', type: 'planning', content: 'created plan for login feature', duration: 200 },
        { agent: 'Bob', role: 'worker', type: 'execution', content: 'implemented auth module', duration: 1500 },
        { agent: 'Carol', role: 'reviewer', type: 'review', content: 'approved auth module', duration: 300 },
      ],
      artifacts: [
        { name: 'plan.md', type: 'document', content: 'Login feature plan' },
        { name: 'auth.js', type: 'code', content: 'export function login() { return true; }' },
      ],
      tokenSummary: { total: 3000, planning: 800, execution: 1500, review: 700 },
      costSummary: { total: 0.15, currency: 'USD' },
      passed: true,
    });

    runFailed = store.createRun({
      projectId: projectB.id,
      agentProfileIds: [worker.id, reviewer.id],
      status: 'failed',
      events: [
        { agent: 'Bob', role: 'worker', type: 'execution', content: 'failed to connect to database', duration: 500 },
        { agent: 'Carol', role: 'reviewer', type: 'review', content: 'found critical bug in implementation', duration: 200 },
      ],
      artifacts: [
        { name: 'error.log', type: 'log', content: 'ConnectionTimeout: database unreachable' },
      ],
      tokenSummary: { total: 1200, planning: 0, execution: 800, review: 400 },
      costSummary: { total: 0.06, currency: 'USD' },
      passed: false,
    });
  });

  it('filters runs by project id', () => {
    const runs = searchRuns(store, { projectId: projectA.id });
    assert.equal(runs.length, 2);
    assert.ok(runs.every(r => r.projectId === projectA.id));
  });

  it('filters runs by status', () => {
    const runs = searchRuns(store, { status: 'completed' });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, runCompleted.id);
  });

  it('filters runs by agent name in events', () => {
    const runs = searchRuns(store, { agentName: 'Bob' });
    assert.equal(runs.length, 2);
    assert.ok(runs.every(r => r.events.some(e => e.agent === 'Bob')));
  });

  it('filters runs by artifact content text', () => {
    const runs = searchRuns(store, { artifactContent: 'ConnectionTimeout' });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, runFailed.id);
  });

  it('returns empty array when no runs match', () => {
    const runs = searchRuns(store, { status: 'nonexistent' });
    assert.deepEqual(runs, []);
  });

  it('combines multiple filters (AND)', () => {
    // Only runCompleted matches projectA + completed
    const runs = searchRuns(store, { projectId: projectA.id, status: 'completed' });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, runCompleted.id);
  });

  it('searches by artifact content with partial match', () => {
    const runs = searchRuns(store, { artifactContent: 'login' });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, runCompleted.id);
  });

  it('lists all runs when no filters are provided', () => {
    const runs = searchRuns(store, {});
    assert.equal(runs.length, 3);
  });
});
