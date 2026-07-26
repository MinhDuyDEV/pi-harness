/**
 * gpt-personality had no test at all while silently rewriting the system
 * prompt of every openai-codex session (audit H-B). These bind the opt-in
 * gate and the model targeting.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import gptExtension from "./extension.js";

type Handler = (event: { systemPrompt: string }, ctx: unknown) => { systemPrompt: string } | undefined;

function install(): Handler {
  let handler: Handler | undefined;
  gptExtension({
    on(name: string, next: Handler) {
      if (name === "before_agent_start") handler = next;
    },
  } as unknown as ExtensionAPI);
  assert.ok(handler);
  return handler!;
}

function projectWithSettings(settings: unknown): string {
  const cwd = mkdtempSync(join(tmpdir(), "gpt-personality-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(settings), "utf8");
  return cwd;
}

test("does nothing without the opt-in — a consumer's prompt is not the harness's to shape", () => {
  const cwd = projectWithSettings({});
  try {
    const result = install()(
      { systemPrompt: "base" },
      { cwd, model: { provider: "openai-codex", id: "gpt-5.5-codex" } },
    );
    assert.equal(result, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("opt-in appends the personality for openai-codex, minus gpt-5.6", () => {
  const cwd = projectWithSettings({ "pi-harness": { gptPersonality: true } });
  try {
    const handler = install();
    const applied = handler(
      { systemPrompt: "base" },
      { cwd, model: { provider: "openai-codex", id: "gpt-5.5-codex" } },
    );
    assert.match(applied?.systemPrompt ?? "", /^base\n\n/);
    assert.match(applied?.systemPrompt ?? "", /pragmatic, effective software engineer/);

    // gpt-5.6 ships its own tuned personality — excluded even when opted in.
    assert.equal(
      handler({ systemPrompt: "base" }, { cwd, model: { provider: "openai-codex", id: "gpt-5.6" } }),
      undefined,
    );
    // Other providers are never touched.
    assert.equal(
      handler({ systemPrompt: "base" }, { cwd, model: { provider: "anthropic", id: "claude-opus-5" } }),
      undefined,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
