import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  xaiCodeExecutionTool,
  xaiCritiqueTool,
  xaiGenerateTextTool,
  xaiMultiAgentTool,
  xaiWebSearchTool,
  xaiXSearchTool,
} from "./custom-tools";
import { xaiAnalyzeImageTool, xaiGenerateImageTool } from "./image-tools";
import { xaiDeepResearchTool } from "./research-tools";

const xaiToolRegistry = {
  xai_generate_text: xaiGenerateTextTool,
  xai_multi_agent: xaiMultiAgentTool,
  xai_web_search: xaiWebSearchTool,
  xai_x_search: xaiXSearchTool,
  xai_code_execution: xaiCodeExecutionTool,
  xai_generate_image: xaiGenerateImageTool,
  xai_critique: xaiCritiqueTool,
  xai_analyze_image: xaiAnalyzeImageTool,
  xai_deep_research: xaiDeepResearchTool,
} as const;

/** Register the OAuth-backed custom xAI tools whose names are in `enabled`. */
export function registerCustomXaiTools(pi: ExtensionAPI, enabled: Set<string>): void {
  for (const [name, tool] of Object.entries(xaiToolRegistry)) {
    if (enabled.has(name)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pi.registerTool(tool as any);
    }
  }
}
