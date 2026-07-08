/** Shared types for the xai extension. Kept in one place so tool
 *  schemas, response readers, and request builders agree on shapes. */

/** Minimal shape of an xAI Responses API response we actually consume. */
export interface XaiResponsesData {
  id?: string;
  output_text?: string;
  output?: ReadonlyArray<{ content?: ReadonlyArray<{ text?: string }> }>;
  reasoning?: { content?: ReadonlyArray<{ text?: string }> };
}

export interface XaiResponsesBody {
  model: string;
  input: unknown;
  reasoning?: { effort: string };
  text?: { format: { type: string } };
  previous_response_id?: string;
  tools?: ReadonlyArray<Record<string, unknown>>;
  instructions?: string;
  include?: string[];
}

/** An error thrown by an xAI fetch, augmented with HTTP status. */
export interface XaiError extends Error {
  status?: number;
}
