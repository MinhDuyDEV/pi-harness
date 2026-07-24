import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { XaiToolDef } from "./define-tool.js";
import {
  xaiCodeExecutionTool,
  xaiCritiqueTool,
  xaiGenerateTextTool,
  xaiMultiAgentTool,
  xaiWebSearchTool,
  xaiXSearchTool,
} from "./custom-tools.js";
import { xaiAnalyzeImageTool, xaiGenerateImageTool } from "./image-tools.js";
import { xaiDeepResearchTool } from "./research-tools.js";

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

export function adaptXaiTool(tool: XaiToolDef): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return tool.execute({ toolCallId, params, signal, onUpdate, ctx });
    },
  };
}

export function registerCustomXaiTools(pi: ExtensionAPI, enabled: Set<string>): void {
  for (const [name, tool] of Object.entries(xaiToolRegistry)) {
    if (enabled.has(name)) pi.registerTool(adaptXaiTool(tool));
  }
}
