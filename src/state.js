/**
 * Search/filter runs in a Store.
 *
 * @param {import('./storage.js').Store} store
 * @param {object} filters
 * @param {string} [filters.projectId] exact project id
 * @param {string} [filters.status] exact run status
 * @param {string} [filters.agentName] partial agent profile/event name
 * @param {string} [filters.artifactContent] partial artifact content text
 * @param {string} [filters.text] partial text across artifacts/events
 * @returns {Array} matching runs
 */
export function searchRuns(store, filters = {}) {
  let runs = store.listRuns();

  if (filters.projectId) {
    runs = runs.filter((run) => run.projectId === filters.projectId);
  }

  if (filters.status) {
    runs = runs.filter((run) => run.status === filters.status);
  }

  if (filters.agentName) {
    const name = filters.agentName.toLowerCase();
    runs = runs.filter((run) => {
      const referencedAgents = (run.agentProfileIds ?? [])
        .map((id) => store.getAgentProfile(id)?.name ?? '')
        .join(' ')
        .toLowerCase();
      const eventAgents = (run.events ?? [])
        .map((event) => `${event.agent ?? ''} ${event.agentName ?? ''}`)
        .join(' ')
        .toLowerCase();
      return referencedAgents.includes(name) || eventAgents.includes(name);
    });
  }

  const artifactNeedle = (filters.artifactContent ?? filters.text ?? '').toLowerCase();
  if (artifactNeedle) {
    runs = runs.filter((run) => {
      const artifactText = (run.artifacts ?? [])
        .map((artifact) => `${artifact.name ?? ''} ${artifact.content ?? ''}`)
        .join(' ')
        .toLowerCase();
      const eventText = (run.events ?? [])
        .map((event) => `${event.message ?? ''} ${event.content ?? ''}`)
        .join(' ')
        .toLowerCase();
      return artifactText.includes(artifactNeedle) || eventText.includes(artifactNeedle);
    });
  }

  return runs;
}
