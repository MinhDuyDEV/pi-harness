import { createDcpReplayPort } from "../dcp/replay.js";
import type { ReplayPort } from "./public-replay.js";

interface ReplayModule {
  createReplayPort?: (input: { projectDirectory: string }) => ReplayPort<unknown>;
  createOrchestrationReplayPort?: (input: { projectDirectory: string }) => ReplayPort<unknown>;
  createTodoReplayPort?: (input: { projectDirectory: string }) => ReplayPort<unknown>;
  createDcpReplayPort?: (input: { projectDirectory: string }) => ReplayPort<unknown>;
}

async function loadPort(
  specifier: string,
  projectDirectory: string,
  factoryNames: readonly (keyof ReplayModule)[],
): Promise<ReplayPort<unknown> | undefined> {
  try {
    const module = await import(specifier);
    for (const name of factoryNames) {
      const factory = module[name];
      if (typeof factory === "function") return factory({ projectDirectory });
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function loadProducerReplayPorts(projectDirectory: string): Promise<Array<{
  producer: "pi-subagents" | "pi-todo" | "dcp";
  port: ReplayPort<unknown>;
}>> {
  const [subagents, todo] = await Promise.all([    loadPort("@minhduydev/pi-subagents/replay", projectDirectory, [
      "createOrchestrationReplayPort",
      "createReplayPort",
    ]),
    loadPort("@minhduydev/pi-todo/replay", projectDirectory, [
      "createTodoReplayPort",
      "createReplayPort",
    ]),
  ]);
  const dcp = createDcpReplayPort({ projectDirectory });
  return [
    ...(subagents ? [{ producer: "pi-subagents" as const, port: subagents }] : []),
    ...(todo ? [{ producer: "pi-todo" as const, port: todo }] : []),
    ...(dcp ? [{ producer: "dcp" as const, port: dcp }] : []),
  ];
}
