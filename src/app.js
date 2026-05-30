import { simulateRun } from './simulator.js';

const STORAGE_KEY = 'agent-workbench-data-v2';
const LEGACY_STORAGE_KEY = 'agent-workbench-data';
const STATUS_LABELS = { pending: 'Pending', idle: 'Idle', running: 'Running', completed: 'Completed', failed: 'Failed' };
const STATUS_ICONS = { pending: '○', idle: '○', running: '⟳', completed: '✓', failed: '✗' };

let state = { projects: [], agentProfiles: [], runs: [], nextId: 1 };
let filters = { search: '', projectId: '', status: '', agentName: '' };
let selectedRunId = null;
let selectedArtifactId = null;
let confirmAction = null;

function uid(prefix = 'id') {
  state.nextId += 1;
  return `${prefix}-${state.nextId}`;
}

function now() {
  return new Date().toISOString();
}

function byId(list, id) {
  return list.find((item) => item.id === id);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function truncate(value, max = 160) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name ?? 'Untitled agent',
    role: profile.role ?? 'worker',
    model: profile.model ?? 'gpt-4o',
    thinkingLevel: profile.thinkingLevel ?? 'medium',
    allowedTools: Array.isArray(profile.allowedTools) ? profile.allowedTools : [],
    systemPrompt: profile.systemPrompt ?? '',
    createdAt: profile.createdAt ?? now(),
    updatedAt: profile.updatedAt ?? now(),
  };
}

function normalizeRun(run) {
  const agentProfileIds = run.agentProfileIds ?? (run.agentProfileId ? [run.agentProfileId] : []);
  return {
    id: run.id,
    projectId: run.projectId,
    agentProfileIds,
    input: run.input ?? '',
    status: run.status ?? 'pending',
    passed: run.passed ?? null,
    result: run.result ?? '',
    events: Array.isArray(run.events) ? run.events : [],
    artifacts: Array.isArray(run.artifacts) ? run.artifacts : [],
    usage: run.usage ?? null,
    createdAt: run.createdAt ?? now(),
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
  };
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state = {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      agentProfiles: Array.isArray(parsed.agentProfiles) ? parsed.agentProfiles.map(normalizeProfile) : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs.map(normalizeRun) : [],
      nextId: Number(parsed.nextId) || 1,
    };
    save();
  } catch (error) {
    console.error('Failed to load Agent Workbench state', error);
  }
}

function createProject(name, description) {
  const project = { id: uid('project'), name: name.trim(), description: description.trim(), createdAt: now(), updatedAt: now() };
  state.projects.push(project);
  save();
  return project;
}

function updateProject(id, name, description) {
  const project = byId(state.projects, id);
  if (!project) return;
  project.name = name.trim();
  project.description = description.trim();
  project.updatedAt = now();
  save();
}

function deleteProject(id) {
  state.projects = state.projects.filter((project) => project.id !== id);
  if (selectedRunId && byId(state.runs, selectedRunId)?.projectId === id) selectedRunId = null;
  save();
}

function readAllowedTools() {
  return Array.from(document.querySelectorAll('input[name="allowedTools"]:checked')).map((input) => input.value);
}

function setAllowedTools(values = []) {
  document.querySelectorAll('input[name="allowedTools"]').forEach((input) => {
    input.checked = values.includes(input.value);
  });
}

function createAgentProfile(data) {
  const profile = normalizeProfile({ id: uid('agent'), ...data, createdAt: now(), updatedAt: now() });
  state.agentProfiles.push(profile);
  save();
  return profile;
}

function updateAgentProfile(id, data) {
  const profile = byId(state.agentProfiles, id);
  if (!profile) return;
  Object.assign(profile, data, { updatedAt: now() });
  save();
}

function deleteAgentProfile(id) {
  state.agentProfiles = state.agentProfiles.filter((profile) => profile.id !== id);
  save();
}

function agentsForRun(run) {
  return run.agentProfileIds.map((id) => byId(state.agentProfiles, id)).filter(Boolean);
}

function agentNamesForRun(run) {
  const names = agentsForRun(run).map((profile) => profile.name);
  return names.length ? names.join(', ') : 'Unknown agents';
}

function getProjectName(id) {
  return byId(state.projects, id)?.name ?? 'Unknown project';
}

function eventTimestamp(run, index) {
  return new Date(Date.parse(run.startedAt ?? run.createdAt) + index * 45000).toISOString();
}

function startRun(projectId, agentProfileIds, input) {
  const run = {
    id: uid('run'),
    projectId,
    agentProfileIds,
    input: input.trim(),
    status: 'running',
    passed: null,
    result: '',
    events: [],
    artifacts: [],
    usage: null,
    createdAt: now(),
    startedAt: now(),
    completedAt: null,
  };

  const project = byId(state.projects, projectId);
  const profiles = agentProfileIds.map((id) => byId(state.agentProfiles, id)).filter(Boolean);
  const simulated = simulateRun(project, profiles);

  run.events = [
    { id: `${run.id}-created`, type: 'started', label: 'Started', timestamp: eventTimestamp(run, 0), message: 'Run started locally.' },
    ...simulated.events.map((event, index) => ({
      id: `${run.id}-${event.id}`,
      type: event.type,
      label: event.phase,
      timestamp: eventTimestamp(run, index + 1),
      message: event.content,
      agentName: event.agentName,
      role: event.role,
    })),
  ];
  run.artifacts = simulated.artifacts.map((artifact, index) => ({ ...artifact, id: `${run.id}-${artifact.id}-${index}` }));
  run.usage = {
    agents: simulated.perAgentUsage,
    totalTokens: simulated.tokenSummary.total,
    totalCost: simulated.costSummary.total,
    currency: simulated.costSummary.currency,
  };
  run.passed = simulated.passed;
  run.status = simulated.passed ? 'completed' : 'failed';
  run.result = simulated.passed ? 'PASS — simulated reviewer approved the run.' : 'FAIL — simulated reviewer found blocking issues.';
  run.completedAt = eventTimestamp(run, run.events.length + 1);
  state.runs.unshift(run);
  selectedRunId = run.id;
  selectedArtifactId = run.artifacts[0]?.id ?? null;
  save();
  return run;
}

function deleteRun(id) {
  state.runs = state.runs.filter((run) => run.id !== id);
  if (selectedRunId === id) selectedRunId = null;
  save();
}

function renderStatusBadge(status, passed = null) {
  const label = STATUS_LABELS[status] ?? status;
  const passText = passed === null ? '' : passed ? ' · Pass' : ' · Fail';
  return `<span class="status-badge status-${escapeHtml(status)}" role="status" aria-label="${escapeHtml(label + passText)}"><span aria-hidden="true">${STATUS_ICONS[status] ?? '•'}</span><span>${escapeHtml(label + passText)}</span></span>`;
}

function clearFieldErrors(formId) {
  document.querySelectorAll(`#${formId} .field-msg`).forEach((node) => { node.textContent = ''; });
}

function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  const messageNode = field.closest('.field')?.querySelector('.field-msg');
  if (messageNode) messageNode.textContent = message;
  field.focus();
}

function showForm(formId) {
  const form = document.getElementById(formId);
  form.hidden = false;
  form.querySelector('input, select, textarea')?.focus();
}

function hideForm(formId) {
  const form = document.getElementById(formId);
  form.hidden = true;
  form.reset();
  delete form.dataset.editId;
  clearFieldErrors(formId);
  setAllowedTools([]);
}

function switchTab(panelName) {
  if (panelName !== 'runs') closeRunDetail(false);
  document.querySelectorAll('.tab-btn').forEach((button) => {
    const selected = button.dataset.panel === panelName;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.hidden = panel.id !== `panel-${panelName}`;
  });
}

function renderProjects() {
  const list = document.getElementById('list-projects');
  const empty = document.getElementById('empty-projects');
  list.querySelectorAll('.card').forEach((node) => node.remove());
  empty.hidden = state.projects.length > 0;
  state.projects.forEach((project) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('role', 'listitem');
    card.innerHTML = `<div class="card-header"><h3 class="card-title">${escapeHtml(project.name)}</h3><div class="card-actions"><button class="btn btn--ghost btn--sm" data-action="edit-project" data-id="${project.id}" type="button">Edit</button><button class="btn btn--ghost btn--sm" data-action="delete-project" data-id="${project.id}" type="button">Delete</button></div></div>${project.description ? `<div class="card-body"><p>${escapeHtml(project.description)}</p></div>` : ''}<div class="card-meta"><span>Created: ${formatDate(project.createdAt)}</span><span>Updated: ${formatDate(project.updatedAt)}</span></div>`;
    list.appendChild(card);
  });
}

function renderAgents() {
  const list = document.getElementById('list-agents');
  const empty = document.getElementById('empty-agents');
  list.querySelectorAll('.card').forEach((node) => node.remove());
  empty.hidden = state.agentProfiles.length > 0;
  state.agentProfiles.forEach((profile) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('role', 'listitem');
    card.innerHTML = `<div class="card-header"><h3 class="card-title">${escapeHtml(profile.name)}</h3><div class="card-actions"><button class="btn btn--ghost btn--sm" data-action="edit-agent" data-id="${profile.id}" type="button">Edit</button><button class="btn btn--ghost btn--sm" data-action="delete-agent" data-id="${profile.id}" type="button">Delete</button></div></div><div class="card-body"><p><span class="card-meta-label">Role:</span> ${escapeHtml(profile.role)}</p><p><span class="card-meta-label">Model:</span> ${escapeHtml(profile.model)}</p><p><span class="card-meta-label">Thinking:</span> ${escapeHtml(profile.thinkingLevel)}</p><p><span class="card-meta-label">Allowed tools:</span> ${escapeHtml(profile.allowedTools.join(', ') || 'None')}</p>${profile.systemPrompt ? `<p><span class="card-meta-label">System prompt:</span> ${escapeHtml(truncate(profile.systemPrompt, 120))}</p>` : ''}</div>`;
    list.appendChild(card);
  });
}

function populateProjectFilters() {
  const select = document.getElementById('filter-project');
  const currentValue = select.value;
  select.innerHTML = '<option value="">All Projects</option>';
  state.projects.forEach((project) => select.append(new Option(project.name, project.id)));
  select.value = currentValue;
}

function populateRunFormSelects() {
  const projectSelect = document.getElementById('run-project');
  const agentSelect = document.getElementById('run-agents');
  projectSelect.innerHTML = '<option value="">— Select a project —</option>';
  state.projects.forEach((project) => projectSelect.append(new Option(project.name, project.id)));
  agentSelect.innerHTML = '';
  state.agentProfiles.forEach((profile) => agentSelect.append(new Option(`${profile.name} (${profile.role}, ${profile.model})`, profile.id)));
}

function filterRuns() {
  return state.runs.filter((run) => {
    if (filters.projectId && run.projectId !== filters.projectId) return false;
    if (filters.status && run.status !== filters.status) return false;
    if (filters.agentName && !agentNamesForRun(run).toLowerCase().includes(filters.agentName.toLowerCase())) return false;
    if (filters.search) {
      const text = [
        run.id,
        getProjectName(run.projectId),
        agentNamesForRun(run),
        run.status,
        run.result,
        run.input,
        ...run.events.map((event) => event.message),
        ...run.artifacts.flatMap((artifact) => [artifact.name, artifact.content]),
      ].join(' ').toLowerCase();
      if (!text.includes(filters.search.toLowerCase())) return false;
    }
    return true;
  });
}

function renderRuns() {
  const list = document.getElementById('list-runs');
  const empty = document.getElementById('empty-runs');
  list.querySelectorAll('.card').forEach((node) => node.remove());
  const runs = filterRuns();
  empty.hidden = runs.length > 0;
  empty.textContent = state.runs.length ? 'No runs match your filters.' : 'No runs started yet. Select a project and agent profiles to begin.';
  runs.forEach((run) => {
    const card = document.createElement('article');
    card.className = 'card card--run';
    card.setAttribute('role', 'listitem');
    card.tabIndex = 0;
    card.dataset.runId = run.id;
    card.innerHTML = `<div class="card-header"><h3 class="card-title">${escapeHtml(run.id)}</h3><div class="card-actions"><button class="btn btn--ghost btn--sm" data-action="delete-run" data-id="${run.id}" type="button">Delete</button></div></div><div class="card-body"><p><span class="card-meta-label">Project:</span> ${escapeHtml(getProjectName(run.projectId))}</p><p><span class="card-meta-label">Agents:</span> ${escapeHtml(agentNamesForRun(run))}</p><p>${renderStatusBadge(run.status, run.passed)}</p>${run.input ? `<div class="card-run-input">${escapeHtml(truncate(run.input, 220))}</div>` : ''}${run.usage ? `<p class="card-run-tokens">Tokens: ${run.usage.totalTokens.toLocaleString()} · Cost: $${run.usage.totalCost.toFixed(4)}</p>` : ''}</div><div class="card-meta"><span>Created: ${formatDate(run.createdAt)}</span><span>Completed: ${formatDate(run.completedAt)}</span></div>`;
    card.addEventListener('click', (event) => {
      if (!event.target.closest('[data-action]')) openRunDetail(run.id);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openRunDetail(run.id);
      }
    });
    list.appendChild(card);
  });
}

function openRunDetail(runId) {
  selectedRunId = runId;
  selectedArtifactId = byId(state.runs, runId)?.artifacts[0]?.id ?? null;
  renderRunDetail();
}

function closeRunDetail(focusTab = true) {
  selectedRunId = null;
  selectedArtifactId = null;
  document.getElementById('run-detail').hidden = true;
  document.getElementById('run-filters').hidden = false;
  document.getElementById('list-runs').hidden = false;
  if (focusTab) document.getElementById('tab-runs').focus();
}

function renderTimeline(run) {
  return `<ol class="timeline">${run.events.map((event) => `<li class="timeline-item"><div class="timeline-icon timeline-icon--${escapeHtml(event.type)}" aria-hidden="true">${event.type === 'failed' ? '✗' : event.type === 'completed' ? '✓' : '•'}</div><div class="timeline-content"><time class="timeline-time">${formatDate(event.timestamp)}</time><p class="timeline-message">${escapeHtml(event.message)}</p><span class="timeline-label">${escapeHtml(`${event.label ?? event.type}${event.agentName ? ` · ${event.agentName}` : ''}`)}</span></div></li>`).join('')}</ol>`;
}

function renderUsage(run) {
  if (!run.usage?.agents?.length) return '<p class="empty-section">No usage data available.</p>';
  const rows = run.usage.agents.map((agent) => `<tr><td>${escapeHtml(agent.agentName)}</td><td>${escapeHtml(agent.role)}</td><td>${escapeHtml(agent.model)}</td><td class="num">${agent.promptTokens.toLocaleString()}</td><td class="num">${agent.completionTokens.toLocaleString()}</td><td class="num">${agent.totalTokens.toLocaleString()}</td><td class="num">$${agent.cost.toFixed(4)}</td></tr>`).join('');
  return `<div class="usage-wrapper"><table class="usage-table"><thead><tr><th scope="col">Agent</th><th scope="col">Role</th><th scope="col">Model</th><th scope="col" class="num">Prompt</th><th scope="col" class="num">Completion</th><th scope="col" class="num">Total</th><th scope="col" class="num">Cost</th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="usage-total"><td colspan="5"><strong>Total</strong></td><td class="num"><strong>${run.usage.totalTokens.toLocaleString()}</strong></td><td class="num"><strong>$${run.usage.totalCost.toFixed(4)}</strong></td></tr></tfoot></table></div>`;
}

function renderArtifacts(run) {
  if (!run.artifacts.length) return '<p class="empty-section">No artifacts produced.</p>';
  const items = run.artifacts.map((artifact) => `<li><button class="artifact-option ${artifact.id === selectedArtifactId ? 'selected' : ''}" data-artifact-id="${artifact.id}" type="button" aria-pressed="${artifact.id === selectedArtifactId}"><span class="artifact-type-badge">${escapeHtml(artifact.type)}</span><span class="artifact-name">${escapeHtml(artifact.name)}</span></button></li>`).join('');
  const artifact = byId(run.artifacts, selectedArtifactId) ?? run.artifacts[0];
  selectedArtifactId = artifact.id;
  return `<div class="detail-artifacts"><ul class="artifacts-list" aria-label="Artifacts">${items}</ul><div class="artifact-preview" role="region" aria-label="Selected artifact preview"><div class="artifact-preview-header"><strong>${escapeHtml(artifact.name)}</strong><span class="artifact-type-badge">${escapeHtml(artifact.type)}</span></div><pre class="artifact-preview-content"><code>${escapeHtml(artifact.content)}</code></pre></div></div>`;
}

function renderRunDetail() {
  const run = byId(state.runs, selectedRunId);
  if (!run) return;
  document.getElementById('run-filters').hidden = true;
  document.getElementById('list-runs').hidden = true;
  const detail = document.getElementById('run-detail');
  detail.hidden = false;
  document.getElementById('run-detail-body').innerHTML = `<header class="run-detail-header"><button class="btn btn--ghost btn--sm" id="btn-back-to-runs" type="button">← Back to Runs</button><div class="run-detail-title-group"><h3 class="run-detail-title">${escapeHtml(run.id)}</h3>${renderStatusBadge(run.status, run.passed)}</div></header><div class="run-detail-meta"><span><span class="card-meta-label">Project:</span> ${escapeHtml(getProjectName(run.projectId))}</span><span><span class="card-meta-label">Agents:</span> ${escapeHtml(agentNamesForRun(run))}</span><span><span class="card-meta-label">Pass/fail:</span> ${run.passed ? 'Pass' : 'Fail'}</span></div><div class="run-detail-grid"><section class="detail-section detail-section--timeline" aria-labelledby="timeline-title"><h4 id="timeline-title" class="detail-section-title">Event timeline</h4>${renderTimeline(run)}</section><div class="detail-sidebar"><section class="detail-section" aria-labelledby="usage-title"><h4 id="usage-title" class="detail-section-title">Per-agent tokens and cost</h4>${renderUsage(run)}</section><section class="detail-section" aria-labelledby="artifacts-title"><h4 id="artifacts-title" class="detail-section-title">Artifacts</h4>${renderArtifacts(run)}</section><section class="detail-section" aria-labelledby="result-title"><h4 id="result-title" class="detail-section-title">Status</h4><p>${escapeHtml(run.result)}</p></section></div></div>`;
  document.getElementById('btn-back-to-runs').addEventListener('click', () => closeRunDetail());
  detail.querySelectorAll('[data-artifact-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedArtifactId = button.dataset.artifactId;
      renderRunDetail();
    });
  });
}

function renderAll() {
  renderProjects();
  renderAgents();
  renderRuns();
  populateProjectFilters();
  if (selectedRunId) renderRunDetail();
}

function showConfirm(message, onConfirm) {
  const dialog = document.getElementById('confirm-dialog');
  document.getElementById('confirm-message').textContent = message;
  confirmAction = onConfirm;
  dialog.showModal();
}

function wireEvents() {
  document.querySelector('.tab-bar').addEventListener('click', (event) => {
    const button = event.target.closest('.tab-btn');
    if (button) switchTab(button.dataset.panel);
  });

  document.querySelector('.tab-bar').addEventListener('keydown', (event) => {
    const tabs = Array.from(document.querySelectorAll('.tab-btn'));
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    switchTab(tabs[next].dataset.panel);
    tabs[next].focus();
  });

  document.getElementById('btn-add-project').addEventListener('click', () => {
    const form = document.getElementById('form-project');
    form.querySelector('button[type="submit"]').textContent = 'Save Project';
    document.getElementById('form-project-title').textContent = 'New Project';
    hideForm('form-agent');
    hideForm('form-run');
    showForm('form-project');
  });
  document.getElementById('btn-cancel-project').addEventListener('click', () => hideForm('form-project'));
  document.getElementById('form-project').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('project-name').value.trim();
    if (!name) return showFieldError('project-name', 'Project name is required.');
    const description = document.getElementById('project-description').value;
    event.currentTarget.dataset.editId ? updateProject(event.currentTarget.dataset.editId, name, description) : createProject(name, description);
    hideForm('form-project');
    renderAll();
  });

  document.getElementById('btn-add-agent').addEventListener('click', () => {
    const form = document.getElementById('form-agent');
    form.querySelector('button[type="submit"]').textContent = 'Save Agent Profile';
    document.getElementById('form-agent-title').textContent = 'New Agent Profile';
    hideForm('form-project');
    hideForm('form-run');
    showForm('form-agent');
    document.getElementById('agent-model').value = 'gpt-4o';
    document.getElementById('agent-thinking-level').value = 'medium';
  });
  document.getElementById('btn-cancel-agent').addEventListener('click', () => hideForm('form-agent'));
  document.getElementById('form-agent').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('agent-name').value.trim();
    const model = document.getElementById('agent-model').value.trim();
    if (!name) return showFieldError('agent-name', 'Profile name is required.');
    if (!model) return showFieldError('agent-model', 'Model string is required.');
    const data = { name, role: document.getElementById('agent-role').value, model, thinkingLevel: document.getElementById('agent-thinking-level').value, allowedTools: readAllowedTools(), systemPrompt: document.getElementById('agent-system-prompt').value.trim() };
    event.currentTarget.dataset.editId ? updateAgentProfile(event.currentTarget.dataset.editId, data) : createAgentProfile(data);
    hideForm('form-agent');
    renderAll();
  });

  document.getElementById('btn-start-run').addEventListener('click', () => {
    populateRunFormSelects();
    hideForm('form-project');
    hideForm('form-agent');
    showForm('form-run');
  });
  document.getElementById('btn-cancel-run').addEventListener('click', () => hideForm('form-run'));
  document.getElementById('form-run').addEventListener('submit', (event) => {
    event.preventDefault();
    const projectId = document.getElementById('run-project').value;
    const agentProfileIds = Array.from(document.getElementById('run-agents').selectedOptions).map((option) => option.value);
    if (!projectId) return showFieldError('run-project', 'Please select a project.');
    if (!agentProfileIds.length) return showFieldError('run-agents', 'Please select at least one agent profile.');
    startRun(projectId, agentProfileIds, document.getElementById('run-input').value);
    hideForm('form-run');
    switchTab('runs');
    renderAll();
  });

  document.getElementById('main-content').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'edit-project') {
      const project = byId(state.projects, id);
      if (!project) return;
      const form = document.getElementById('form-project');
      form.dataset.editId = id;
      document.getElementById('form-project-title').textContent = 'Edit Project';
      form.querySelector('button[type="submit"]').textContent = 'Update Project';
      document.getElementById('project-name').value = project.name;
      document.getElementById('project-description').value = project.description;
      hideForm('form-agent');
      hideForm('form-run');
      showForm('form-project');
    }
    if (action === 'delete-project') showConfirm(`Delete project "${byId(state.projects, id)?.name}"? Related runs stay visible with an unknown-project label.`, () => { deleteProject(id); renderAll(); });
    if (action === 'edit-agent') {
      const profile = byId(state.agentProfiles, id);
      if (!profile) return;
      const form = document.getElementById('form-agent');
      form.dataset.editId = id;
      document.getElementById('form-agent-title').textContent = 'Edit Agent Profile';
      form.querySelector('button[type="submit"]').textContent = 'Update Agent Profile';
      document.getElementById('agent-name').value = profile.name;
      document.getElementById('agent-role').value = profile.role;
      document.getElementById('agent-model').value = profile.model;
      document.getElementById('agent-thinking-level').value = profile.thinkingLevel;
      document.getElementById('agent-system-prompt').value = profile.systemPrompt;
      setAllowedTools(profile.allowedTools);
      hideForm('form-project');
      hideForm('form-run');
      showForm('form-agent');
    }
    if (action === 'delete-agent') showConfirm(`Delete agent profile "${byId(state.agentProfiles, id)?.name}"? Existing runs keep their stored artifacts.`, () => { deleteAgentProfile(id); renderAll(); });
    if (action === 'delete-run') showConfirm(`Delete run "${id}"?`, () => { deleteRun(id); renderAll(); });
  });

  document.getElementById('filter-search').addEventListener('input', (event) => { filters.search = event.target.value; renderRuns(); });
  document.getElementById('filter-project').addEventListener('change', (event) => { filters.projectId = event.target.value; renderRuns(); });
  document.getElementById('filter-status').addEventListener('change', (event) => { filters.status = event.target.value; renderRuns(); });
  document.getElementById('filter-agent').addEventListener('input', (event) => { filters.agentName = event.target.value; renderRuns(); });
  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    filters = { search: '', projectId: '', status: '', agentName: '' };
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-project').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-agent').value = '';
    renderRuns();
  });

  document.getElementById('confirm-yes').addEventListener('click', () => {
    confirmAction?.();
    confirmAction = null;
    document.getElementById('confirm-dialog').close();
  });
  document.getElementById('confirm-no').addEventListener('click', () => document.getElementById('confirm-dialog').close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedRunId) closeRunDetail();
  });
}

load();
wireEvents();
renderAll();
switchTab('projects');
