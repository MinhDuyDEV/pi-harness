/**
 * TilePaintTool — places tiles on a layer by click or drag.
 *
 * Tracks the last-painted tile coordinate to draw continuous lines
 * during drag strokes.
 */

import { Layer } from '../core/Layer';

export class TilePaintTool {
  private lastCol: number = -1;
  private lastRow: number = -1;

  /** Start painting at (col, row). */
  start(layer: Layer, col: number, row: number, tileIndex: number): void {
    this.lastCol = col;
    this.lastRow = row;
    layer.setTile(col, row, tileIndex);
  }

  /** Continue painting at (col, row), drawing a line from the last position. */
  move(layer: Layer, col: number, row: number, tileIndex: number): void {
    if (this.lastCol >= 0 && this.lastRow >= 0) {
      this.drawLine(layer, this.lastCol, this.lastRow, col, row, tileIndex);
    } else {
      layer.setTile(col, row, tileIndex);
    }
    this.lastCol = col;
    this.lastRow = row;
  }

  /** End the stroke. */
  end(): void {
    this.lastCol = -1;
    this.lastRow = -1;
  }

  /** Draw a Bresenham line between two tile coordinates. */
  private drawLine(
    layer: Layer,
    c0: number, r0: number, c1: number, r1: number,
    tileIndex: number,
  ): void {
    const dc = Math.abs(c1 - c0);
    const dr = Math.abs(r1 - r0);
    const sc = c0 < c1 ? 1 : -1;
    const sr = r0 < r1 ? 1 : -1;
    let err = dc - dr;
    let cc = c0;
    let rr = r0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      layer.setTile(cc, rr, tileIndex);
      if (cc === c1 && rr === r1) break;
      const e2 = 2 * err;
      if (e2 > -dr) {
        err -= dr;
        cc += sc;
      }
      if (e2 < dc) {
        err += dc;
        rr += sr;
      }
    }
  }
}
