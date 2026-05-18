#!/usr/bin/env bun
/**
 * pikit-translate: chunker
 *
 * Splits a markdown source file into chunks at markdown block boundaries
 * (headings, paragraphs, code blocks, lists). Each chunk targets ~2000 words
 * while preserving structural integrity.
 *
 * Usage:
 *   bun scripts/main.ts --input source.md --output chunks/
 *   bun scripts/main.ts --input source.md --output chunks/ --max-words 3000
 *   bun scripts/main.ts --input source.md --json        # dry-run info
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, extname, join, resolve } from "path";

interface Chunk {
  index: number;
  path: string;
  heading: string;
  wordCount: number;
  startLine: number;
  endLine: number;
}

interface Options {
  input: string;
  outputDir: string;
  maxWords: number;
  json: boolean;
}

function parseArgs(argv: string[]): Options | null {
  const opts: Options = { input: "", outputDir: "", maxWords: 2000, json: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "--input" || arg === "-i") opts.input = argv[++i] || "";
    else if (arg === "--output" || arg === "-o") opts.outputDir = argv[++i] || "";
    else if (arg === "--max-words" || arg === "-m") {
      const v = parseInt(argv[++i] || "2000");
      if (isNaN(v) || v < 100) { console.error("Invalid --max-words"); return null; }
      opts.maxWords = v;
    } else if (arg === "--json") opts.json = true;
    else if (!arg.startsWith("-") && !opts.input) opts.input = arg;
  }

  if (!opts.input) { console.error("Error: --input is required"); return null; }
  return opts;
}

function printHelp() {
  console.log(`Usage: bun main.ts --input <file> [options]

Split markdown into chunks at block boundaries.

Options:
  -i, --input <file>      Source markdown file (required)
  -o, --output <dir>      Output directory for chunks (default: ./chunks)
  -m, --max-words <n>     Target words per chunk (default: 2000)
      --json              Output chunk info as JSON
  -h, --help              Show help
`);
}

interface Block {
  type: string;
  content: string;
  heading: string;
  startLine: number;
  endLine: number;
  wordCount: number;
}

function parseBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let current: string[] = [];
  let currentType = "paragraph";
  let currentHeading = "";
  let blockStart = 0;

  function flush(endLine: number) {
    if (current.length === 0) return;
    const text = current.join("\n");
    const wc = text.split(/\s+/).filter(Boolean).length;
    blocks.push({
      type: currentType,
      content: text,
      heading: currentHeading,
      startLine: blockStart,
      endLine: endLine,
      wordCount: wc,
    });
    current = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track current heading context
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flush(i - 1);
      currentHeading = headingMatch[2];
      currentType = "heading";
      blockStart = i;
      current = [line];
      continue;
    }

    // Code blocks (``` fences)
    if (trimmed.startsWith("```")) {
      flush(i - 1);
      currentType = "code";
      blockStart = i;
      current = [line];
      for (let j = i + 1; j < lines.length; j++) {
        current.push(lines[j]);
        if (lines[j].trim() === "```" && j > i) {
          flush(j);
          i = j;
          currentType = "paragraph";
          currentHeading = "";
          break;
        }
      }
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      flush(i - 1);
      currentType = "hr";
      blockStart = i;
      current = [line];
      flush(i);
      currentType = "paragraph";
      continue;
    }

    // Empty line = block boundary
    if (trimmed === "") {
      flush(i - 1);
      blockStart = i;
      current = [];
      currentType = "paragraph";
      continue;
    }

    // Accumulate
    if (current.length === 0) blockStart = i;
    current.push(line);
  }

  flush(lines.length - 1);
  return blocks;
}

function chunkBlocks(blocks: Block[], maxWords: number): Block[][] {
  const chunks: Block[][] = [];
  let current: Block[] = [];
  let currentWords = 0;

  for (const block of blocks) {
    // Always start a new chunk at a heading
    if (block.type === "heading" && currentWords > 0 && current.length > 0) {
      chunks.push(current);
      current = [];
      currentWords = 0;
    }

    // If this block alone exceeds maxWords, force it into its own chunk
    if (block.wordCount >= maxWords && current.length === 0) {
      chunks.push([block]);
      continue;
    }

    // If adding this block would exceed maxWords, start new chunk
    if (currentWords + block.wordCount > maxWords && current.length > 0) {
      chunks.push(current);
      current = [];
      currentWords = 0;
    }

    current.push(block);
    currentWords += block.wordCount;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function outputChunks(chunks: Block[][], outputDir: string, baseName: string): Chunk[] {
  mkdirSync(outputDir, { recursive: true });

  return chunks.map((blockGroup, i) => {
    const idx = i + 1;
    const heading = blockGroup.find((b) => b.type === "heading")?.heading || `chunk-${idx}`;
    const slug = heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || `chunk-${idx}`;
    const filename = `${String(idx).padStart(2, "0")}-${slug}.md`;
    const filePath = join(outputDir, filename);
    const content = blockGroup.map((b) => b.content).join("\n");
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    writeFileSync(filePath, content);

    return {
      index: idx,
      path: filePath,
      heading,
      wordCount,
      startLine: blockGroup[0].startLine + 1,
      endLine: blockGroup[blockGroup.length - 1].endLine + 1,
    };
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) process.exit(1);

  const inputPath = resolve(opts.input);
  if (!existsSync(inputPath)) {
    console.error(`Error: ${inputPath} not found`);
    process.exit(1);
  }

  const content = readFileSync(inputPath, "utf-8");
  const blocks = parseBlocks(content);
  const chunks = chunkBlocks(blocks, opts.maxWords);

  const outputDir = opts.outputDir
    ? resolve(opts.outputDir)
    : resolve("chunks");

  const result = outputChunks(chunks, outputDir, basename(inputPath, extname(inputPath)));

  if (opts.json) {
    console.log(JSON.stringify({
      source: inputPath,
      blocks: blocks.length,
      chunks: result.length,
      output: outputDir,
      chunk_info: result,
      stats: {
        total_words: content.split(/\s+/).filter(Boolean).length,
        avg_words_per_chunk: Math.round(
          result.reduce((s, c) => s + c.wordCount, 0) / result.length,
        ),
      },
    }, null, 2));
  } else {
    console.log(`Source: ${inputPath}`);
    console.log(`Blocks: ${blocks.length} → Chunks: ${result.length}`);
    console.log(`Output: ${outputDir}/\n`);
    for (const c of result) {
      const lines = c.endLine - c.startLine + 1;
      console.log(`  ${String(c.index).padStart(2, " ")}. ${c.heading || "(no heading)"}`);
      console.log(`      ${c.path} (${c.wordCount} words, lines ${c.startLine}-${c.endLine})`);
    }
    console.log(`\nDone.`);
  }
}

main();
