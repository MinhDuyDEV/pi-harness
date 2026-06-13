/**
 * Webclaw Extension
 *
 * Thin pi-native wrapper around the `webclaw` CLI binary.
 *
 * Why this exists:
 * - webclaw's unique value is its Rust-side fetch stack with browser/TLS impersonation
 * - that value does NOT port cleanly to TypeScript
 * - the correct pi integration is therefore a subprocess wrapper, not a reimplementation
 *
 * Scope kept intentionally small:
 * - `webclaw_scrape` for a single URL
 * - `webclaw_batch` for multiple URLs
 * - `/webclaw` command for availability/version checks
 *
 * We intentionally do NOT wrap webclaw's LLM/search/research features because pi already
 * has stronger native tools and models for those jobs.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { buildSubprocessEnv } from "./safety/env-policy.js";
import { execFilePromise, isAbortError } from "./lib/util.js";

type OutputFormat = "llm" | "markdown" | "text" | "json" | "html";

const WEBCLAW_BIN = process.env.WEBCLAW_BIN || "webclaw";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32_000;
const MAX_BATCH_URLS = 20;

function truncateOutput(text: string): string {
  const truncated = truncateHead(text, { maxBytes: MAX_OUTPUT_BYTES });
  if (truncated.truncated) {
    truncated.content += `\n\n[Output truncated: ${truncated.bytes} bytes removed. Scrape again with a narrower scope for full content.]`;
  }
  return truncated.content;
}

function runWebclaw(
  args: string[],
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return execFilePromise({
    bin: WEBCLAW_BIN,
    args,
    env: buildSubprocessEnv("webclaw"),
    timeoutMs,
    signal,
  });
}

function formatInstallHint(): string {
  return [
    `webclaw binary not found at \`${WEBCLAW_BIN}\`.`,
    "Install one of:",
    "- `brew install 0xMassi/webclaw/webclaw`",
    "- `cargo install --git https://github.com/0xMassi/webclaw.git webclaw-cli`",
    "Or set `WEBCLAW_BIN` to the binary path.",
  ].join("\n");
}

function buildScrapeArgs(params: {
  url: string;
  format?: OutputFormat;
  include?: string;
  exclude?: string;
  onlyMainContent?: boolean;
  metadata?: boolean;
  timeoutSeconds?: number;
}): string[] {
  const args = [params.url, "-f", params.format || "llm"];

  if (params.include?.trim()) args.push("--include", params.include.trim());
  if (params.exclude?.trim()) args.push("--exclude", params.exclude.trim());
  if (params.onlyMainContent !== false) args.push("--only-main-content");
  if (params.metadata === true) args.push("--metadata");
  if (typeof params.timeoutSeconds === "number" && Number.isFinite(params.timeoutSeconds)) {
    args.push("--timeout", String(Math.max(1, Math.floor(params.timeoutSeconds))));
  }

  return args;
}

export default function webclawExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "webclaw_scrape",
    label: "Webclaw Scrape",
    description: `Scrape a URL using the local webclaw binary.

Prefer this over browser-based scraping when:
- The page is static or mostly server-rendered
- A site blocks normal fetches and benefits from webclaw's TLS/browser impersonation
- You want token-efficient markdown/LLM output

Prefer lightpanda/browser tools instead when:
- The page requires JavaScript execution
- You need interaction, DOM inspection, or rendered state`,
    promptSnippet:
      "Scrape a URL with webclaw for token-efficient content extraction and bot-protected pages.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to scrape" }),
      format: Type.Optional(
        Type.Union(
          [
            Type.Literal("llm"),
            Type.Literal("markdown"),
            Type.Literal("text"),
            Type.Literal("json"),
            Type.Literal("html"),
          ],
          { description: 'Output format. Default: "llm"' },
        ),
      ),
      include: Type.Optional(
        Type.String({ description: 'CSS selectors to include, e.g. "article, .content"' }),
      ),
      exclude: Type.Optional(
        Type.String({ description: 'CSS selectors to exclude, e.g. "nav, footer, .sidebar"' }),
      ),
      onlyMainContent: Type.Optional(
        Type.Boolean({
          description: "Auto-detect and return only the main content. Default: true",
        }),
      ),
      metadata: Type.Optional(
        Type.Boolean({ description: "Include metadata in output where supported" }),
      ),
      timeoutSeconds: Type.Optional(
        Type.Number({ description: "Request timeout in seconds. Default: 30" }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        const args = buildScrapeArgs(params);
        const text = truncateOutput(
          await runWebclaw(args, signal, (params.timeoutSeconds || 30) * 1000),
        );
        return {
          content: [{ type: "text" as const, text }],
          details: {
            url: params.url,
            format: params.format || "llm",
            onlyMainContent: params.onlyMainContent !== false,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const help = /ENOENT|not found/i.test(message)
          ? `\n\n${formatInstallHint()}`
          : "\n\nTip: if the page is JS-heavy, try lightpanda/browser tools instead.";
        return {
          content: [{ type: "text" as const, text: `webclaw_scrape failed: ${message}${help}` }],
          details: { url: params.url, error: message },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "webclaw_batch",
    label: "Webclaw Batch",
    description: `Scrape multiple URLs with the local webclaw binary.
Use this for parallel comparison of several static/bot-protected pages.
Maximum 20 URLs per call.`,
    promptSnippet: "Scrape multiple URLs in parallel with webclaw.",
    parameters: Type.Object({
      urls: Type.Array(Type.String({ description: "URL to scrape" }), {
        description: "URLs to scrape in parallel (max 20)",
      }),
      format: Type.Optional(
        Type.Union(
          [
            Type.Literal("llm"),
            Type.Literal("markdown"),
            Type.Literal("text"),
            Type.Literal("json"),
            Type.Literal("html"),
          ],
          { description: 'Output format. Default: "llm"' },
        ),
      ),
      onlyMainContent: Type.Optional(
        Type.Boolean({
          description: "Auto-detect and return only the main content. Default: true",
        }),
      ),
      timeoutSeconds: Type.Optional(
        Type.Number({ description: "Per-request timeout in seconds. Default: 30" }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const urls = params.urls.slice(0, MAX_BATCH_URLS);
      const timeoutMs = (params.timeoutSeconds || 30) * 1000;
      const results = await Promise.allSettled(
        urls.map(async (url) => {
          const text = await runWebclaw(
            buildScrapeArgs({
              url,
              format: params.format,
              onlyMainContent: params.onlyMainContent,
              timeoutSeconds: params.timeoutSeconds,
            }),
            signal,
            timeoutMs,
          );
          return { url, text };
        }),
      );

      const sections = results.map((result, index) => {
        const url = urls[index];
        if (result.status === "fulfilled") {
          return `## ${url}\n\n${result.value.text}`;
        }
        const reason =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        const help = /ENOENT|not found/i.test(reason) ? `\n\n${formatInstallHint()}` : "";
        return `## ${url}\n\nError: ${reason}${help}`;
      });

      return {
        content: [{ type: "text" as const, text: truncateOutput(sections.join("\n\n---\n\n")) }],
        details: {
          count: urls.length,
          succeeded: results.filter((result) => result.status === "fulfilled").length,
          format: params.format || "llm",
        },
      };
    },
  });

  pi.registerCommand("webclaw", {
    description: "Check webclaw binary availability and version",
    async handler(_args, ctx) {
      try {
        const version = await runWebclaw(["--version"]);
        const output = [
          `webclaw available: ${version}`,
          `Binary: ${WEBCLAW_BIN}`,
          `Cloud API: ${process.env.WEBCLAW_API_KEY ? "configured" : "not set (local-only mode)"}`,
        ].join("\n");
        ctx?.ui?.notify(output, "info");
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const output = `${formatInstallHint()}\n\nFailure: ${message}`;
        ctx?.ui?.notify(output, "error");
        return output;
      }
    },
  });
}
