import { afterEach, describe, expect, it } from "bun:test";
import {
  addBlock,
  cleanupSession,
  getLegacyStatus,
} from "./compress-state.js";
import {
  handleLegacyCommand,
  type LegacyAttestationParams,
} from "./legacy-attestation.js";
import { deleteDurableSessionState } from "./storage.js";

const stateKeys = new Set<string>();

afterEach(() => {
  for (const stateKey of stateKeys) {
    cleanupSession(stateKey);
    deleteDurableSessionState(stateKey);
  }
  stateKeys.clear();
});

function addLegacyBlock(stateKey: string): void {
  stateKeys.add(stateKey);
  addBlock(
    stateKey,
    "legacy state-key regression",
    "Legacy summary bound to the DCP state key.",
    "manual",
    "manual",
  );
}

describe("legacy command state-key binding", () => {
  it("mutates the DCP state key when Pi's session ID differs", async () => {
    const stateKey = `state-key-${Date.now()}-${Math.random()}`;
    const piSessionId = `pi-session-${Date.now()}-${Math.random()}`;
    addLegacyBlock(stateKey);

    let appended = false;
    const params: LegacyAttestationParams = {
      stateKey,
      session: {
        getSessionId: () => piSessionId,
        getLeafId: () => "leaf-current",
        getBranch: () => [{ id: "root" }, { id: "leaf-current" }],
      },
      appendState: () => {
        appended = true;
      },
    };

    await handleLegacyCommand(
      "attest all --yes",
      { notify: () => {}, confirm: async () => false },
      params,
    );

    expect(appended).toBe(true);
    expect(getLegacyStatus(stateKey).attested).toHaveLength(1);
    expect(getLegacyStatus(piSessionId).attested).toHaveLength(0);
  });
});
