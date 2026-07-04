// Fork of pi-xai-oauth v1.2.5: Cursor/Grok CLI shims restored for
// grok-composer-2.5-fast and grok-build; custom xAI tool set via defaults.ts.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getGrokAuthCredentials } from "./xai/auth";
import { XAI_API_BASE_URL, XAI_PROVIDER_ID } from "./xai/constants";
import { MODELS } from "./xai/models";
import { createXaiOAuth } from "./xai/oauth";
import { streamSimpleXaiResponses } from "./xai/responses";
import { registerXaiTools } from "./xai/tools";
import { resolveXaiToolConfig } from "./xai/tools/defaults";
import { syncCursorToolShimsForModel } from "./xai/tools/cursor";

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

  if (typeof (pi as any).on === "function") {
    (pi as any).on("session_start", (_event: any, ctx: any) => syncCursorToolShimsForModel(ctx, ctx?.model));
    (pi as any).on("model_select", (event: any, ctx: any) => syncCursorToolShimsForModel(ctx, event?.model));
    (pi as any).on("before_agent_start", (_event: any, ctx: any) => syncCursorToolShimsForModel(ctx, ctx?.model));
  }
}
