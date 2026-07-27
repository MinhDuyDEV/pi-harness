// Fork of pi-xai-oauth v1.2.5 with the Cursor/Grok CLI compatibility
// shims removed, plus the v1.2.6 image size/n parameter fix (167db38).
// See `.pi/extensions/xai/` for the modules and the
// "fork pi-xai-oauth locally" entry in `.pi/artifacts/TODO.md` for
// context.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readExtensionGate } from "./lib/harness-settings.js";
import { getGrokAuthCredentials } from "./xai/auth";
import { XAI_API_BASE_URL, XAI_PROVIDER_ID } from "./xai/constants";
import { MODELS } from "./xai/models";
import { createXaiOAuth } from "./xai/oauth";
import { streamSimpleXaiResponses } from "./xai/responses";
import { registerXaiTools } from "./xai/tools";
import { resolveXaiToolConfig } from "./xai/tools/defaults";

export default function (pi: ExtensionAPI) {
  // Opt-in gate: a consumer who installs the harness should not get a
  // third-party provider (or its tools) registered until settings.json says so.
  if (!readExtensionGate(undefined, "xai", false)) return;
  pi.registerProvider(XAI_PROVIDER_ID, {
    name: "xAI (OAuth)",
    baseUrl: XAI_API_BASE_URL,
    api: "xai-responses",
    models: MODELS,
    authHeader: true,
    streamSimple: streamSimpleXaiResponses,
    oauth: createXaiOAuth({ getExistingCredentials: getGrokAuthCredentials }),
  });

  registerXaiTools(pi, resolveXaiToolConfig());
}
