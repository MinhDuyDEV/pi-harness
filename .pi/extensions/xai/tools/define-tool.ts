import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";

export type XaiToolExecuteInput = {
  toolCallId: string;
  params: unknown;
  signal: AbortSignal | undefined;
  onUpdate: AgentToolUpdateCallback<unknown> | undefined;
  ctx: ExtensionContext;
};

export type XaiToolDef = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute(input: XaiToolExecuteInput): Promise<AgentToolResult<unknown>>;
};

export function defineXaiTool<S extends TSchema>(def: {
  name: string;
  label: string;
  description: string;
  parameters: S;
  execute(input: Omit<XaiToolExecuteInput, "params"> & { params: Static<S> }): Promise<AgentToolResult<unknown>>;
}): XaiToolDef {
  return {
    ...def,
    execute(input) {
      return def.execute({ ...input, params: input.params as Static<S> });
    },
  };
}
