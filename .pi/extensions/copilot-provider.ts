/**
 * GitHub Copilot Custom Provider Extension for Pi
 *
 * Registers a "github-copilot" provider with a custom "copilot" API type
 * and a streamSimple override that:
 *
 * 1. Routes to the correct built-in API based on model ID:
 *    - claude-* → anthropic-messages (thinking via budget tokens)
 *    - gpt-5*  → openai-responses (reasoning via effort)
 *    - others  → openai-completions
 *
 * 2. Overrides X-Initiator header to avoid premium quota:
 *    Pi's built-in checks only the LAST message role → "user" on every prompt.
 *    We check if ANY message is non-user (OpenCode's trick) → "agent" after
 *    first exchange. Copilot API doesn't count "agent" requests against quota.
 *
 * Why a custom API type? Pi's registerProvider with streamSimple calls
 * registerApiProvider({ api, streamSimple }) — this is a GLOBAL override.
 * Using "copilot" avoids replacing built-in "openai-completions" for ALL models.
 * Inside our handler, we remap model.api to the real type before delegating.
 *
 * Usage:
 *   1. Place in .pi/extensions/copilot-provider.ts
 *   2. Run `/login` in Pi to authenticate with GitHub
 *   3. Select any github-copilot model via `/model`
 */

import {
  type OAuthCredentials,
  type OAuthLoginCallbacks,
  streamSimple as routeStreamSimple,
} from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";

// ─── Constants ──────────────────────────────────────────────

const CLIENT_ID = "Ov23li8tweQw6odWQebz";
const DEFAULT_COPILOT_API_URL = "https://api.githubcopilot.com";

/**
 * Static Copilot headers — propagated to all models via provider-level headers.
 * These make requests look like VS Code Copilot Chat, which is key to
 * avoiding premium quota counting.
 */
const COPILOT_HEADERS: Record<string, string> = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
};

const OAUTH_POLLING_MARGIN_MS = 3000;

// ─── Error Classification ───────────────────────────────────

type ErrorClass =
  | "rate_limit"       // 429, "too many requests" — fallback to different model
  | "auth"             // 401/403, "unauthorized" — not retryable, prompt re-login
  | "billing"          // 402, "insufficient credits" — rotate model immediately
  | "context_overflow"  // "context length", "token limit" — trigger compression
  | "server_error"     // 500/502/503 — retry with backoff
  | "timeout"          // ETIMEDOUT, ECONNRESET — retry with backoff
  | "model_not_found"  // 404, "invalid model" — fallback immediately
  | "unknown";         // catch-all — fallback

interface ClassifiedError {
  class: ErrorClass;
  retryable: boolean;
  shouldCompress: boolean;
  shouldFallback: boolean;
  message: string;
}

const ERROR_PATTERNS: ReadonlyArray<{
  class: ErrorClass;
  patterns: RegExp[];
}> = [
  {
    class: "rate_limit",
    patterns: [
      /too many requests/i,
      /rate\s*limit/i,
      /exhausted this model/i,
      /429/,
      /throttled/i,
      /requests per minute/i,
      /tokens per minute/i,
    ],
  },
  {
    class: "billing",
    patterns: [
      /insufficient credits/i,
      /payment required/i,
      /billing hard limit/i,
      /exceeded your current quota/i,
      /credits have been exhausted/i,
      /402/,
    ],
  },
  {
    class: "context_overflow",
    patterns: [
      /context length/i,
      /context.*too long/i,
      /token limit/i,
      /too many tokens/i,
      /reduce the length/i,
      /maximum context/i,
      /prompt is too long/i,
      /exceeds the limit/i,
    ],
  },
  {
    class: "auth",
    patterns: [
      /unauthorized/i,
      /invalid.*(?:api key|token|credential)/i,
      /authentication failed/i,
      /forbidden/i,
      /access denied/i,
      /401/,
      /403/,
    ],
  },
  {
    class: "server_error",
    patterns: [
      /internal server error/i,
      /bad gateway/i,
      /service unavailable/i,
      /502/,
      /503/,
      /500/,
    ],
  },
  {
    class: "timeout",
    patterns: [
      /timeout/i,
      /ETIMEDOUT/,
      /ECONNRESET/,
      /ECONNREFUSED/,
      /network error/i,
      /socket hang up/i,
    ],
  },
  {
    class: "model_not_found",
    patterns: [
      /model not found/i,
      /invalid model/i,
      /does not exist/i,
      /no such model/i,
      /404/,
    ],
  },
];

function classifyError(errorMessage: string): ClassifiedError {
  const msg = errorMessage || "";

  for (const { class: errorClass, patterns } of ERROR_PATTERNS) {
    if (patterns.some((p) => p.test(msg))) {
      return {
        class: errorClass,
        retryable: errorClass === "server_error" || errorClass === "timeout",
        shouldCompress: errorClass === "context_overflow",
        shouldFallback:
          errorClass === "rate_limit" ||
          errorClass === "billing" ||
          errorClass === "model_not_found",
        message: msg,
      };
    }
  }

  return {
    class: "unknown",
    retryable: false,
    shouldCompress: false,
    shouldFallback: true,
    message: msg,
  };
}

const MODEL_FALLBACKS: Record<string, string> = {
  "claude-opus-4.6": "gpt-5.4",
  "claude-opus-4.5": "gpt-5.4",
  "claude-sonnet-4.6": "claude-haiku-4.5",
  "claude-sonnet-4.5": "claude-haiku-4.5",
  "gpt-5.4": "gpt-5.3-codex",
  "gpt-5.4-mini": "gpt-5-mini",
  "gpt-5.3-codex": "gpt-5.2-codex",
  "gpt-5.2-codex": "gpt-5.1-codex",
  "gpt-5.1-codex": "gpt-5-mini",
  "gemini-3.1-pro-preview": "gemini-3-flash-preview",
  "gemini-3-pro-preview": "gemini-3-flash-preview",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Helpers ────────────────────────────────────────────────

function normalizeDomain(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function getOAuthUrls(domain: string) {
  return {
    deviceCode: `https://${domain}/login/device/code`,
    accessToken: `https://${domain}/login/oauth/access_token`,
  };
}

/**
 * Parse enterprise domain from stored credentials.
 * Format: "token" for github.com, "enterprise:domain:token" for enterprise.
 */
function parseCredentials(credentials: OAuthCredentials): {
  token: string;
  domain: string;
  baseUrl: string;
} {
  const refresh = credentials.refresh;
  if (refresh.startsWith("enterprise:")) {
    const parts = refresh.split(":");
    const domain = parts[1];
    const token = parts.slice(2).join(":");
    return {
      token,
      domain,
      baseUrl: `https://copilot-api.${domain}`,
    };
  }
  return {
    token: refresh,
    domain: "github.com",
    baseUrl: DEFAULT_COPILOT_API_URL,
  };
}

// ─── Models ─────────────────────────────────────────────────

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Compat flags for models that don't support OpenAI reasoning features */
const COMPAT_NO_REASONING = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
};

const COPILOT_MODELS: ProviderModelConfig[] = [
  // ── Claude Models (routed to anthropic-messages by copilotStreamSimple) ──
  {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 160000,
    maxTokens: 32000,
  },
  {
    id: "claude-opus-4.5",
    name: "Claude Opus 4.5",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 160000,
    maxTokens: 32000,
  },
  {
    id: "claude-opus-4.6",
    name: "Claude Opus 4.6",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 192000,
    maxTokens: 64000,
  },
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 144000,
    maxTokens: 16000,
  },
  {
    id: "claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 160000,
    maxTokens: 32000,
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 160000,
    maxTokens: 32000,
  },
  // ── GPT-4.x Models (routed to openai-completions — no reasoning) ──
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    reasoning: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 128000,
    maxTokens: 16384,
    compat: COMPAT_NO_REASONING,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    reasoning: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 128000,
    maxTokens: 16384,
    compat: COMPAT_NO_REASONING,
  },
  // ── GPT-5.x Models (routed to openai-responses — reasoning via effort) ──
  {
    id: "gpt-5-mini",
    name: "GPT-5 mini",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 192000,
    maxTokens: 64000,
  },
  {
    id: "gpt-5.1",
    name: "GPT-5.1",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 192000,
    maxTokens: 64000,
  },
  {
    id: "gpt-5.1-codex",
    name: "GPT-5.1-Codex",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 256000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1-Codex-Max",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 256000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1-Codex-Mini",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 256000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 192000,
    maxTokens: 64000,
  },
  {
    id: "gpt-5.2-codex",
    name: "GPT-5.2-Codex",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3-Codex",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 400000,
    maxTokens: 128000,
  },
  // ── Gemini Models (routed to openai-completions) ──
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    reasoning: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 173000,
    maxTokens: 64000,
    compat: COMPAT_NO_REASONING,
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 173000,
    maxTokens: 64000,
    compat: COMPAT_NO_REASONING,
  },
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 173000,
    maxTokens: 64000,
    compat: COMPAT_NO_REASONING,
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 173000,
    maxTokens: 64000,
    compat: COMPAT_NO_REASONING,
  },
  // ── xAI Models (routed to openai-completions) ──
  {
    id: "grok-code-fast-1",
    name: "Grok Code Fast 1",
    reasoning: true,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: 173000,
    maxTokens: 64000,
    compat: COMPAT_NO_REASONING,
  },
  // ── Fine-tuned Models (routed to openai-completions) ──
  {
    id: "raptor-mini",
    name: "Raptor mini",
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 264000,
    maxTokens: 64000,
  },
];

// ─── OAuth Device Code Flow ─────────────────────────────────

async function loginCopilot(
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
  // Ask for enterprise URL (empty = github.com)
  const enterpriseInput = await callbacks.onPrompt({
    message: "Enter GitHub Enterprise URL (leave empty for github.com):",
  });

  const domain = enterpriseInput
    ? normalizeDomain(enterpriseInput)
    : "github.com";
  const urls = getOAuthUrls(domain);

  // Request device code
  const deviceResponse = await fetch(urls.deviceCode, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "GitHubCopilotChat/0.35.0",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: "read:user",
    }),
  });

  if (!deviceResponse.ok) {
    throw new Error(
      `Failed to initiate device authorization (${deviceResponse.status})`,
    );
  }

  const deviceData = await deviceResponse.json();

  // Show device code to user via onAuth (Pi's OAuth callback for URLs)
  callbacks.onAuth({
    url: deviceData.verification_uri,
    instructions: `Enter code: ${deviceData.user_code}`,
  });

  // Poll for access token
  let pollInterval = deviceData.interval || 5;

  while (true) {
    await sleep(pollInterval * 1000 + OAUTH_POLLING_MARGIN_MS);

    const response = await fetch(urls.accessToken, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "GitHubCopilotChat/0.35.0",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceData.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!response.ok) {
      throw new Error(`OAuth token request failed (${response.status})`);
    }

    const data = await response.json();

    if (data.access_token) {
      // Store enterprise domain in the refresh field for later use
      // Format: "token" for github.com, "enterprise:domain:token" for enterprise
      const tokenPayload =
        domain !== "github.com"
          ? `enterprise:${domain}:${data.access_token}`
          : data.access_token;

      return {
        refresh: tokenPayload,
        access: data.access_token,
        expires: 0, // GitHub tokens don't expire
      };
    }

    if (data.error === "authorization_pending") {
      continue;
    }

    if (data.error === "slow_down") {
      // RFC spec: add 5 seconds to polling interval
      pollInterval = data.interval || pollInterval + 5;
      continue;
    }

    if (data.error) {
      throw new Error(
        `OAuth error: ${data.error} - ${data.error_description || ""}`,
      );
    }
  }
}

// ─── Stream Override (Quota Avoidance) ──────────────────────

/**
 * Map model ID to the real Pi API type for correct stream function routing.
 *
 * All our models use the custom "copilot" API type (to avoid global override),
 * but the actual streaming must go through the correct built-in handler.
 */
function getTargetApi(modelId: string): string {
  if (modelId.startsWith("claude-")) return "anthropic-messages";
  if (modelId.startsWith("gpt-5")) return "openai-responses";
  return "openai-completions";
}

function getFallbackModelId(modelId: string): string | undefined {
  return MODEL_FALLBACKS[modelId];
}

/**
 * Custom streamSimple that:
 *
 * 1. Remaps model.api from "copilot" → real API type (anthropic-messages,
 *    openai-responses, openai-completions) based on model ID.
 *
 * 2. Forces X-Initiator to "agent" on ALL requests to avoid premium quota.
 *    Copilot API doesn't count "agent"-initiated requests against quota.
 *
 * options.headers is applied LAST by all three Pi stream functions,
 * overriding the dynamic copilot headers (X-Initiator, Copilot-Vision-Request).
 *
 * No infinite loop: routeStreamSimple resolves the REAL api types
 * (anthropic-messages / openai-completions / openai-responses), not "copilot".
 */
function copilotStreamSimple(model: any, context: any, options?: any): any {
  // Remap to real API type — routeStreamSimple will resolve to built-in handler
  const realApi = getTargetApi(model.id);

  return routeStreamSimple({ ...model, api: realApi }, context, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      "X-Initiator": "agent", // Always "agent" — zero premium quota usage
    },
  });
}

// ─── Extension Entry Point ──────────────────────────────────

export default function copilotProvider(pi: ExtensionAPI) {
  pi.registerProvider("github-copilot", {
    baseUrl: DEFAULT_COPILOT_API_URL,
    api: "copilot", // Custom API type — avoids replacing built-in global handlers
    headers: COPILOT_HEADERS, // Static headers merged into all models by Pi
    authHeader: true,
    models: COPILOT_MODELS,
    streamSimple: copilotStreamSimple, // Routes to real API + overrides X-Initiator
    oauth: {
      name: "GitHub Copilot",
      login: loginCopilot,
      refreshToken(credentials: OAuthCredentials) {
        // GitHub access tokens from device code flow don't expire
        return Promise.resolve(credentials);
      },
      getApiKey(credentials: OAuthCredentials) {
        return credentials.access;
      },
      modifyModels(models, credentials) {
        // For enterprise, update baseUrl on all models
        const { baseUrl } = parseCredentials(credentials);
        if (baseUrl !== DEFAULT_COPILOT_API_URL) {
          return models.map((m) => ({ ...m, baseUrl }));
        }
        return models;
      },
    },
  });

  // Auto-fallback for model-specific rate limits.
  // We only switch model for subsequent turns (never auto-replay the same prompt).
  // Structured error recovery — classifies errors and routes to correct action.
  // Replaces the old rate-limit-only handler with full classification.
  pi.on("turn_end", async (event: any, ctx: any) => {
    const msg = event?.message;
    if (!msg || msg.role !== "assistant") return;
    if (msg.provider !== "github-copilot") return;
    if (msg.stopReason !== "error") return;

    const errorMessage = String(msg.errorMessage || "");
    const classified = classifyError(errorMessage);
    const currentModelId = String(msg.model || "");

    // Auth errors: not recoverable via model switch — notify user
    if (classified.class === "auth") {
      ctx.ui.notify(
        `Authentication error on github-copilot/${currentModelId}. Run /login to re-authenticate.`,
        "error",
      );
      return;
    }

    // Context overflow: suggest compression, don't switch model
    if (classified.shouldCompress) {
      ctx.ui.notify(
        `Context overflow on github-copilot/${currentModelId}. Use the compress tool to reduce context size before continuing.`,
        "warning",
      );
      return;
    }

    // For errors that should fallback to a different model
    if (classified.shouldFallback) {
      const fallbackModelId = getFallbackModelId(currentModelId);
      if (!fallbackModelId) {
        ctx.ui.notify(
          `${classified.class} on github-copilot/${currentModelId}. No fallback model available.\n${classified.message}`,
          "error",
        );
        return;
      }

      const fallbackModel = ctx.modelRegistry.find(
        "github-copilot",
        fallbackModelId,
      );
      if (!fallbackModel) {
        ctx.ui.notify(
          `${classified.class} on github-copilot/${currentModelId}. Fallback github-copilot/${fallbackModelId} not found.`,
          "warning",
        );
        return;
      }

      const switched = await pi.setModel(fallbackModel);
      if (switched) {
        ctx.ui.notify(
          `${classified.class} on github-copilot/${currentModelId}. Switched to github-copilot/${fallbackModelId} for next turn.`,
          "warning",
        );
      } else {
        ctx.ui.notify(
          `${classified.class} on github-copilot/${currentModelId}. Could not switch to github-copilot/${fallbackModelId}.`,
          "warning",
        );
      }
      return;
    }

    // Retryable but no fallback needed (server_error, timeout) — just notify
    if (classified.retryable) {
      ctx.ui.notify(
        `Transient error (${classified.class}) on github-copilot/${currentModelId}. Retry your last message.`,
        "warning",
      );
      return;
    }

    // Unknown / unclassified — generic notification
    ctx.ui.notify(
      `Error on github-copilot/${currentModelId}: ${classified.message}`,
      "error",
    );
  });
}
