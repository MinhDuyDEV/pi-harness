/**
 * SpriteGenerator — generates pixel-art sprite data from a text prompt.
 *
 * Sends palette + dimensions to the LLM and receives pixel index grid.
 */

import { AIClient } from './AIClient';

export interface SpriteGenResult {
  pixels: number[][]; // 2D array of palette indices (row-major)
  description?: string;
}

export class SpriteGenerator {
  /**
   * Generate a sprite from a text description.
   * @param prompt   What to draw (e.g. "a red mushroom with white spots")
   * @param width    Sprite width in pixels
   * @param height   Sprite height in pixels
   * @param palette  Array of hex colour strings
   * @param abortSignal Optional cancellation
   */
  static async generate(
    prompt: string,
    width: number,
    height: number,
    palette: string[],
    abortSignal?: AbortSignal,
  ): Promise<SpriteGenResult> {
    const paletteDesc = palette
      .map((hex, i) => `  ${i + 1}: ${hex}`)
      .join('\n');

    const systemPrompt = `You are a pixel-art generator. You create pixel sprites using a provided colour palette.
The first colour (index 0) is always transparent/empty.
Create sprites that are clear, readable, and follow retro pixel-art aesthetics (limited palette, clean outlines).

Return JSON with this structure:
{
  "pixels": [[row0], [row1], ...],
  "description": "brief description"
}

Each row is an array of integers (palette indices). Index 0 = transparent.
The pixel array must be exactly ${width} columns × ${height} rows.`;

    const userPrompt = `Palette:
${paletteDesc}

Generate a ${width}×${height} pixel-art sprite of: ${prompt}

Use only indices from the palette above.
Index 0 = transparent (use for background/empty areas).
Make it recognisable and well-proportioned for the given size.`;

    const content = await AIClient.generate(systemPrompt, userPrompt, abortSignal);
    const result = JSON.parse(content) as SpriteGenResult;

    // Validate dimensions
    if (!Array.isArray(result.pixels) || result.pixels.length !== height) {
      throw new Error(`Expected ${height} rows, got ${result.pixels?.length}`);
    }
    for (let r = 0; r < result.pixels.length; r++) {
      if (!Array.isArray(result.pixels[r]) || result.pixels[r].length !== width) {
        throw new Error(`Row ${r}: expected ${width} columns, got ${result.pixels[r]?.length}`);
      }
    }

    return result;
  }
}
