import { existsSync, readFileSync } from "fs";
import { basename, extname, isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function unescapeShellPath(value: string): string {
  return stripShellQuotes(value).replace(/\\([\\\s'"()&;@])/g, "$1");
}

function resolveLocalPdfPath(value: string): string | undefined {
  const cleaned = unescapeShellPath(value);
  if (!cleaned) return undefined;

  if (cleaned.startsWith("file://")) {
    try {
      return fileURLToPath(cleaned);
    } catch {
      return undefined;
    }
  }

  const candidates = [cleaned];
  if (!isAbsolute(cleaned)) candidates.push(resolve(process.cwd(), cleaned));

  return candidates.find((candidate) => existsSync(candidate));
}

function inferPdfFilename(source: string, explicitFilename?: string): string {
  if (typeof explicitFilename === "string" && explicitFilename.trim()) return explicitFilename.trim();

  const localPath = resolveLocalPdfPath(source);
  if (localPath) return basename(localPath);

  if (/^https?:\/\//i.test(source)) {
    try {
      const parsed = new URL(source);
      const tail = basename(parsed.pathname);
      if (tail && tail !== "/") return tail;
    } catch {
      // Fall through to the default filename.
    }
  }

  return "attachment.pdf";
}

function isLikelyPdfBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (!(compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(compact))) {
    return false;
  }

  try {
    return Buffer.from(compact, "base64").subarray(0, 4).toString("latin1") === "%PDF";
  } catch {
    return false;
  }
}

export type NormalizedXaiPdfInput = {
  file_data?: string;
  file_url?: string;
  filename?: string;
};

/** Normalize a PDF URL/path/base64 blob into an xAI-compatible input_file payload. */
export function normalizeXaiPdfInput(
  value: unknown,
  options?: { mimeType?: unknown; filename?: unknown },
): NormalizedXaiPdfInput | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  const cleaned = stripShellQuotes(value);
  const mimeType = typeof options?.mimeType === "string" ? options.mimeType.trim().toLowerCase() : "";
  const explicitFilename = typeof options?.filename === "string" ? options.filename.trim() : "";
  const pdfHint =
    mimeType === "application/pdf" ||
    explicitFilename.toLowerCase().endsWith(".pdf") ||
    cleaned.toLowerCase().endsWith(".pdf") ||
    /^data:application\/pdf;base64,/i.test(cleaned);

  if (!pdfHint) return undefined;

  if (/^https?:\/\//i.test(cleaned)) {
    return {
      file_url: cleaned,
      filename: inferPdfFilename(cleaned, explicitFilename),
    };
  }

  if (/^data:application\/pdf;base64,/i.test(cleaned)) {
    return {
      file_data: cleaned,
      filename: inferPdfFilename(cleaned, explicitFilename),
    };
  }

  const localPath = resolveLocalPdfPath(cleaned);
  if (localPath) {
    if (extname(localPath).toLowerCase() !== ".pdf") {
      throw new Error("xAI file understanding currently supports local PDF files only");
    }
    const data = readFileSync(localPath).toString("base64");
    return {
      file_data: `data:application/pdf;base64,${data}`,
      filename: inferPdfFilename(localPath, explicitFilename),
    };
  }

  if (isLikelyPdfBase64(cleaned)) {
    return {
      file_data: `data:application/pdf;base64,${cleaned.replace(/\s+/g, "")}`,
      filename: inferPdfFilename(cleaned, explicitFilename),
    };
  }

  throw new Error(`PDF file does not exist or is not a valid URL/data URI: ${cleaned}`);
}
