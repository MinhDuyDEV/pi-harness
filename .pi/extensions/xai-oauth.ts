// Fork of pi-xai-oauth v1.2.5 with the Cursor/Grok CLI compatibility
// shims removed, plus the v1.2.6 image size/n parameter fix (167db38).
// See `.pi/extensions/xai/` for the modules and the
// "fork pi-xai-oauth locally" entry in `.pi/artifacts/TODO.md` for
// context.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getGrokAuthCredentials } from "./xai/auth";
import { XAI_API_BASE_URL, XAI_PROVIDER_ID } from "./xai/constants";
import { MODELS } from "./xai/models";
import { createXaiOAuth } from "./xai/oauth";
import { streamSimpleXaiResponses } from "./xai/responses";
import { registerXaiTools } from "./xai/tools";
import { resolveXaiToolConfig } from "./xai/tools/defaults";

export default function (pi: ExtensionAPI) {
  pi.registerProvider(XAI_PROVIDER_ID, {
    name: "xAI (OAuth)",
    baseUrl: XAI_API_BASE_URL,
    api: "xai-responses",
    models: MODELS as any,
    authHeader: true,
    streamSimple: streamSimpleXaiResponses as any,
    oauth: createXaiOAuth({ getExistingCredentials: getGrokAuthCredentials }) as any,
  });

  registerXaiTools(pi, resolveXaiToolConfig());
}
