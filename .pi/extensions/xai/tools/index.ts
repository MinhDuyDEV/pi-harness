// Fork of pi-xai-oauth's tool registration, with the Cursor/Grok CLI
// compatibility shims removed. Only the custom xAI tools in the
// `enabled` set are registered (see ./defaults.ts for the default
// list and the PI_XAI_ENABLE_TOOLS / PI_XAI_DISABLE_TOOLS overrides).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCustomXaiTools } from "./custom-tools";

const xaiToolRegistrations = new WeakSet<object>();

/** Register the configured xAI tools once per pi API object. */
export function registerXaiTools(pi: ExtensionAPI, enabled: Set<string>) {
  if (xaiToolRegistrations.has(pi as object)) return;
  xaiToolRegistrations.add(pi as object);

  registerCustomXaiTools(pi, enabled);
}
