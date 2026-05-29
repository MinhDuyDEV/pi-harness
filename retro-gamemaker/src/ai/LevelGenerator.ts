/**
 * LevelGenerator — generates tile placement data from a level description.
 *
 * Sends available tile info + map dimensions to the LLM and receives
 * per-layer tile index arrays.
 */

import { AIClient } from './AIClient';

export interface LevelGenResult {
  /** Per-layer tile index arrays (flat row-major) */
  layers: number[][];
  /** Optional collision data (0 = passable, 1 = solid) */
  collision?: number[];
}

export class LevelGenerator {
  /**
   * Generate tile placements for a level.
   * @param prompt     Level description (e.g. "a grassy field with a river through the middle")
   * @param mapWidth   Map width in tiles
   * @param mapHeight  Map height in tiles
   * @param layerCount Number of layers
   * @param tileLabels Descriptions of each tile palette entry
   * @param abortSignal Optional cancellation
   */
  static async generate(
    prompt: string,
    mapWidth: number,
    mapHeight: number,
    layerCount: number,
    tileLabels: string[],
    abortSignal?: AbortSignal,
  ): Promise<LevelGenResult> {
    const tileDesc = tileLabels
      .map((label, i) => `  ${i + 1}: ${label}`)
      .join('\n');

    const systemPrompt = `You are a game level designer. You create tile-based levels for pixel-art games.
Tile index 0 = empty/air. Higher indices = different tile types (ground, platforms, walls, etc.).
Design levels that are fun, playable, and well-structured.

Return JSON with this structure:
{
  "layers": [[layer0_flat_tiles], [layer1_flat_tiles], ...],
  "collision": [flat_collision_array]
}

Each layer array is a flat array (row-major) of tile indices.
Layer 0 = background/base, layer 1 = foreground/details.
The collision array has 1 for solid tiles, 0 for passable (same dimensions).
All arrays must be exactly ${mapWidth * mapHeight} elements long.`;

    const userPrompt = `Map: ${mapWidth} tiles wide × ${mapHeight} tiles tall
Layers: ${layerCount}
Available tiles:
${tileDesc}

Design a level: ${prompt}

- Layer 0 should contain the base terrain/background.
- Layer 1 should contain foreground details, platforms, etc.
- Mark solid tiles in the collision layer.
- Keep the level interesting but playable.
- Use tile index 0 for empty spaces.`;

    const content = await AIClient.generate(systemPrompt, userPrompt, abortSignal);
    const result = JSON.parse(content) as LevelGenResult;

    // Validate
    const expectedLen = mapWidth * mapHeight;
    if (!Array.isArray(result.layers) || result.layers.length < layerCount) {
      throw new Error(`Expected ${layerCount} layers, got ${result.layers?.length}`);
    }
    for (let i = 0; i < result.layers.length; i++) {
      if (result.layers[i].length !== expectedLen) {
        throw new Error(`Layer ${i}: expected ${expectedLen} tiles, got ${result.layers[i].length}`);
      }
    }
    if (result.collision && result.collision.length !== expectedLen) {
      throw new Error(`Collision: expected ${expectedLen}, got ${result.collision.length}`);
    }

    return result;
  }
}
