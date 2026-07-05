/**
 * Resolve LLM-shaped messages from Pi extension context.
 * Agent events: getForkMessages / getBranchMessages.
 * Commands: sessionManager.buildSessionContext() or getBranchEntries + buildSessionContext.
 */

import type { Message } from "@earendil-works/pi-ai";
import {
  buildSessionContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type BranchCtx = ExtensionContext & {
  getForkMessages?: () => Message[];
  getBranchMessages?: () => Message[];
  getBranchEntries?: () => Parameters<typeof buildSessionContext>[0];
};

type SessionManagerLike = {
  buildSessionContext?: () => { messages: Message[] };
};

export function getSessionBranchMessages(ctx: ExtensionContext): Message[] {
  const c = ctx as BranchCtx;

  if (typeof c.getForkMessages === "function") {
    return c.getForkMessages();
  }
  if (typeof c.getBranchMessages === "function") {
    return c.getBranchMessages();
  }

  const sm = c.sessionManager as SessionManagerLike | undefined;
  if (sm && typeof sm.buildSessionContext === "function") {
    return sm.buildSessionContext().messages;
  }

  if (typeof c.getBranchEntries === "function") {
    const entries = c.getBranchEntries();
    if (entries.length > 0) {
      const { messages } = buildSessionContext(entries);
      return messages as Message[];
    }
  }

  return [];
}