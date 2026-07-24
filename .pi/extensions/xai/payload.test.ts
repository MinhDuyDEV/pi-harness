import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { xaiModelForRequest } from "./models";
import { rewriteXaiResponsesPayload } from "./payload";

test("rewriteXaiResponsesPayload defaults prompt_cache_key from session id and strips retention", () => {
  const payload = rewriteXaiResponsesPayload(
    {
      model: "grok-4.5",
      prompt_cache_retention: { type: "ephemeral" },
      input: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    },
    xaiModelForRequest("grok-4.5"),
    { sessionId: "session-123" } as any,
  ) as Record<string, any>;

  assert.equal(payload.prompt_cache_key, "session-123");
  assert.ok(!("prompt_cache_retention" in payload));
});

test("rewriteXaiResponsesPayload preserves explicit prompt_cache_key values", () => {
  const payload = rewriteXaiResponsesPayload(
    {
      model: "grok-4.5",
      prompt_cache_key: "custom-cache-key",
      input: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    },
    xaiModelForRequest("grok-4.5"),
    { sessionId: "session-123" } as any,
  ) as Record<string, any>;

  assert.equal(payload.prompt_cache_key, "custom-cache-key");
});

test("rewriteXaiResponsesPayload allows prompt_cache_key opt-out with false", () => {
  const payload = rewriteXaiResponsesPayload(
    {
      model: "grok-4.5",
      prompt_cache_key: false,
      input: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    },
    xaiModelForRequest("grok-4.5"),
    { sessionId: "session-123" } as any,
  ) as Record<string, any>;

  assert.ok(!("prompt_cache_key" in payload));
});

test("rewriteXaiResponsesPayload normalizes local PDF file parts into xAI input_file data URIs", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-harness-xai-pdf-"));
  const pdfPath = join(dir, "quarterly-report.pdf");
  writeFileSync(pdfPath, "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

  try {
    const payload = rewriteXaiResponsesPayload(
      {
        model: "grok-4.5",
        input: [
          {
            role: "user",
            content: [
              {
                type: "file",
                file: {
                  data: pdfPath,
                  mimeType: "application/pdf",
                  filename: "quarterly-report.pdf",
                },
              },
            ],
          },
        ],
      },
      xaiModelForRequest("grok-4.5"),
    ) as Record<string, any>;

    const filePart = payload.input[0].content[0] as Record<string, any>;
    assert.deepEqual(Object.keys(filePart).sort(), ["file_data", "filename", "type"]);
    assert.equal(filePart.type, "input_file");
    assert.equal(filePart.filename, "quarterly-report.pdf");
    assert.match(filePart.file_data, /^data:application\/pdf;base64,/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rewriteXaiResponsesPayload normalizes already-tagged input_file PDF parts", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-harness-xai-input-file-"));
  const pdfPath = join(dir, "spec.pdf");
  writeFileSync(pdfPath, "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

  try {
    const payload = rewriteXaiResponsesPayload(
      {
        model: "grok-4.5",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file",
                file_data: pdfPath,
                mimeType: "application/pdf",
                filename: "spec.pdf",
              },
            ],
          },
        ],
      },
      xaiModelForRequest("grok-4.5"),
    ) as Record<string, any>;

    assert.deepEqual(payload.input[0].content[0], {
      type: "input_file",
      file_data: payload.input[0].content[0].file_data,
      filename: "spec.pdf",
    });
    assert.match(payload.input[0].content[0].file_data, /^data:application\/pdf;base64,/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rewriteXaiResponsesPayload normalizes PDF URLs into xAI input_file file_url parts", () => {
  const payload = rewriteXaiResponsesPayload(
    {
      model: "grok-4.5",
      input: [
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                url: "https://example.com/invoice.pdf",
                mimeType: "application/pdf",
              },
            },
          ],
        },
      ],
    },
    xaiModelForRequest("grok-4.5"),
  ) as Record<string, any>;

  const filePart = payload.input[0].content[0] as Record<string, any>;
  assert.deepEqual(filePart, {
    type: "input_file",
    file_url: "https://example.com/invoice.pdf",
    filename: "invoice.pdf",
  });
});
