import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readExtensionGate } from "./lib/harness-settings.js";

export default function (pi: ExtensionAPI) {
  if (!readExtensionGate(undefined, "shortcutContinue", false)) return;
  pi.registerShortcut("shift+alt+enter", {
    description: 'Send "continue" when the agent is stopped',
    handler: (ctx) => {
      if (ctx.isIdle()) pi.sendUserMessage("continue");
    },
  });
}
