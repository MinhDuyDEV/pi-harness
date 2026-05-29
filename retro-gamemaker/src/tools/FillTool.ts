/**
 * FillTool — flood-fill (bucket fill) using a stack-based algorithm.
 *
 * Replaces all contiguous pixels of the target colour with the active colour.
 * Uses an explicit stack (not recursion) to avoid stack overflow on large sprites.
 */

import { Sprite } from '../core/Sprite';

export class FillTool {
  /**
   * Flood-fill starting at (x, y). Replaces matching adjacent pixels with colourIndex.
   * Returns the number of pixels changed (0 if no change).
   */
  execute(sprite: Sprite, x: number, y: number, colourIndex: number): number {
    // Out of bounds or already the target colour → no-op
    if (x < 0 || x >= sprite.width || y < 0 || y >= sprite.height) return 0;

    const targetIndex = sprite.getPixel(x, y);
    if (targetIndex === colourIndex) return 0;

    const w = sprite.width;
    const h = sprite.height;
    const pixels = sprite.pixels;
    let count = 0;

    const stack: Array<{ x: number; y: number }> = [{ x, y }];

    while (stack.length > 0) {
      const { x: cx, y: cy } = stack.pop()!;
      const idx = cy * w + cx;

      if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
      if (pixels[idx] !== targetIndex) continue;

      pixels[idx] = colourIndex;
      count++;

      stack.push({ x: cx - 1, y: cy });
      stack.push({ x: cx + 1, y: cy });
      stack.push({ x: cx, y: cy - 1 });
      stack.push({ x: cx, y: cy + 1 });
    }

    return count;
  }
}
