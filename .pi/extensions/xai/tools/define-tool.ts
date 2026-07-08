import type { Static, TSchema } from "@earendil-works/pi-ai";

export type XaiToolExecute = (input: {
  toolCallId: string;
  params: unknown;
  signal: AbortSignal | undefined;
  onUpdate: unknown;
  ctx: unknown;
}) => Promise<unknown>;

export interface XaiToolDef {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute: XaiToolExecute;
}

/** Build a typed tool definition. The runtime object is cast to `any` so
 *  pi's `registerTool` accepts it without a module-resolution error. */
export function defineXaiTool<S extends TSchema>(def: {
  name: string;
  label: string;
  description: string;
  parameters: S;
  execute: (input: { toolCallId: string; params: Static<S>; signal: AbortSignal | undefined; onUpdate: unknown; ctx: unknown }) => Promise<unknown>;
}): XaiToolDef {
  return def as unknown as XaiToolDef;
}
