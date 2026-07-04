// Fork of pi-xai-oauth tool registration: Cursor/Grok CLI shims for
// grok-composer-2.5-fast / grok-build, plus configurable custom xAI tools
// (see ./defaults.ts and PI_XAI_ENABLE_TOOLS / PI_XAI_DISABLE_TOOLS).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCursorToolShims } from "./cursor";
import { registerCustomXaiTools } from "./custom-tools";

const xaiToolRegistrations = new WeakSet<object>();

/** Register Cursor shims and configured xAI tools once per pi API object. */
export function registerXaiTools(pi: ExtensionAPI, enabled: Set<string>) {
  if (xaiToolRegistrations.has(pi as object)) return;
  xaiToolRegistrations.add(pi as object);

  registerCursorToolShims(pi);
  registerCustomXaiTools(pi, enabled);
}