/**
 * PaintTool — draw (pencil) and erase individual pixels.
 *
 * Tracks the last-drawn pixel so continuous strokes don't leave gaps.
 */

import { Sprite } from '../core/Sprite';

export type PaintMode = 'draw' | 'erase';

export class PaintTool {
  mode: PaintMode;
  private lastX: number = -1;
  private lastY: number = -1;

  constructor(mode: PaintMode = 'draw') {
    this.mode = mode;
  }

  /** Called when the mouse button is first pressed on a pixel. */
  start(sprite: Sprite, x: number, y: number, colourIndex: number): void {
    this.lastX = x;
    this.lastY = y;
    this.apply(sprite, x, y, colourIndex);
  }

  /** Called as the mouse moves with the button held. Draws a line from the last pixel. */
  move(sprite: Sprite, x: number, y: number, colourIndex: number): void {
    if (this.lastX < 0 || this.lastY < 0) {
      this.apply(sprite, x, y, colourIndex);
    } else {
      this.drawLine(sprite, this.lastX, this.lastY, x, y, colourIndex);
    }
    this.lastX = x;
    this.lastY = y;
  }

  /** Called when the mouse button is released. */
  end(): void {
    this.lastX = -1;
    this.lastY = -1;
  }

  private apply(sprite: Sprite, x: number, y: number, colourIndex: number): void {
    const idx = this.mode === 'erase' ? Sprite.TRANSPARENT : colourIndex;
    sprite.setPixel(x, y, idx);
  }

  /** Bresenham-style line drawing between two pixels. */
  private drawLine(
    sprite: Sprite,
    x0: number, y0: number, x1: number, y1: number,
    colourIndex: number,
  ): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let cx = x0;
    let cy = y0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.apply(sprite, cx, cy, colourIndex);
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
  }
}
