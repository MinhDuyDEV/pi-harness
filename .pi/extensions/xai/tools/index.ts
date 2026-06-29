// Fork of pi-xai-oauth's tool registration, with the Cursor/Grok CLI
// compatibility shims removed. Only the custom xAI tools (web search,
// X search, code execution, image gen/analysis, critique, multi-agent,
// deep research, generate text) are registered.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCustomXaiTools } from "./custom-tools";

const xaiToolRegistrations = new WeakSet<object>();

/** Register all xAI tools once per pi API object. */
export function registerXaiTools(pi: ExtensionAPI) {
  if (xaiToolRegistrations.has(pi as object)) return;
  xaiToolRegistrations.add(pi as object);

  registerCustomXaiTools(pi);
}
