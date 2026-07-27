export interface DiscoveredGate {
  command: string;
  cwd: string;
  source: string;
  kind: string;
}

export interface GateDiscovery {
  status: "ready" | "ambiguous" | "none";
  gates: DiscoveredGate[];
  sources: string[];
  conflicts: string[];
}

export function discoverRepositoryGates(projectRoot: string): Promise<GateDiscovery>;
