/**
 * DeepSeek thinking mode utilities
 *
 * Stolen from Reasonix (src/loop/thinking.ts) — MIT License
 *
 * DeepSeek's thinking/reasoning models have specific quirks:
 * - reasoning_content MUST be round-tripped or the API 400s on follow-ups
 * - V4 models (flash/pro) are thinking-mode models
 * - Models hallucinate DSML (DeepSeek Markup Language) tool-call envelopes
 *   that need to be stripped from assistant content
 * - request extra_body.thinking.type differs by model
 */

/**
 * True when the model emits reasoning_content and requires it round-tripped
 * on follow-up requests. DeepSeek rejects follow-up messages from thinking
 * models that omit reasoning_content.
 */
export function isThinkingModeModel(model: string): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  if (m === "deepseek-v4-flash" || m === "deepseek-v4-pro") return true;
  if (m.endsWith("-nonthinking")) return false;
  // Generic fallback: most "deepseek-*" models are thinking models
  if (m.startsWith("deepseek-") && !m.includes("instruct")) return true;
  return false;
}

/**
 * Returns the thinking mode value for the model.
 * - `"enabled"` — send `extra_body.thinking.type = "enabled"`
 * - `"disabled"` — send `extra_body.thinking.type = "disabled"`
 * - `undefined` — omit the field entirely (for third-party endpoints)
 */
export function thinkingModeForModel(model: string): "enabled" | "disabled" | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (m.endsWith("-nonthinking")) return "disabled";
  if (m === "deepseek-v4-flash" || m === "deepseek-v4-pro") return "enabled";
  return undefined;
}

/**
 * Strip hallucinated tool-call markup that DeepSeek models sometimes emit
 * in the text stream instead of (or in addition to) proper tool_calls.
 *
 * DeepSeek R1/V4 emit DSML (DeepSeek Markup Language) tags like:
 *   <｜DSML｜function_calls>...</｜DSML｜function_calls>
 *   <function_calls>...</function_calls>
 *
 * If not stripped, these leak into the conversation and confuse subsequent turns.
 */
export function stripHallucinatedToolMarkup(
  s: string | null | undefined,
  options: { trim?: boolean } = {},
): string {
  if (!s) return s ?? "";
  let out = s;

  // DeepSeek's DSML envelope (full-width "｜" is the form R1 emits in practice)
  out = out.replace(/<｜DSML｜function_calls>[\s\S]*?<\/?｜DSML｜function_calls>/g, "");

  // Standard XML-style function_calls envelope (some models emit this)
  out = out.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "");

  // Lone unpaired DSML opener left over after R1 truncates mid-call
  out = out.replace(/<｜DSML｜[\s\S]*$/g, "");

  // Lone unpaired function_calls opener
  out = out.replace(/<function_calls>[\s\S]*$/g, "");

  return options.trim === false ? out : out.trim();
}

/**
 * Strip DSML from all assistant messages in an array (in-place return).
 */
export function stripAllDSML(
  messages: Array<{ role: string; content?: string | null }>,
): { stripped: number } {
  let stripped = 0;
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.content) {
      const cleaned = stripHallucinatedToolMarkup(msg.content);
      if (cleaned !== msg.content) {
        msg.content = cleaned;
        stripped++;
      }
    }
  }
  return { stripped };
}
