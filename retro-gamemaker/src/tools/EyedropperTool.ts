/**
 * EyedropperTool — picks the palette index at a given pixel.
 *
 * Returns the colour index (1-based) at the clicked position,
 * or 0 (transparent) if out of bounds.
 */

import { Sprite } from '../core/Sprite';

export class EyedropperTool {
  /**
   * Sample the colour index at (x, y).
   * Returns: { colourIndex, hex } or null if out of bounds or transparent.
   */
  sample(sprite: Sprite, x: number, y: number, palette: string[]): { colourIndex: number; hex: string } | null {
    if (x < 0 || x >= sprite.width || y < 0 || y >= sprite.height) return null;

    const colourIndex = sprite.getPixel(x, y);
    if (colourIndex === 0) return null; // transparent

    const hex = palette[colourIndex - 1];
    if (!hex) return null;

    return { colourIndex, hex };
  }
}
