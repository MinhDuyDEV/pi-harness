/**
 * TileEraseTool — removes tiles (sets to 0/empty) on click or drag.
 *
 * Identical strategy to TilePaintTool but always writes tile index 0.
 */

import { Layer } from '../core/Layer';

export class TileEraseTool {
  private lastCol: number = -1;
  private lastRow: number = -1;

  start(layer: Layer, col: number, row: number): void {
    this.lastCol = col;
    this.lastRow = row;
    layer.setTile(col, row, 0);
  }

  move(layer: Layer, col: number, row: number): void {
    if (this.lastCol >= 0 && this.lastRow >= 0) {
      this.drawLine(layer, this.lastCol, this.lastRow, col, row);
    } else {
      layer.setTile(col, row, 0);
    }
    this.lastCol = col;
    this.lastRow = row;
  }

  end(): void {
    this.lastCol = -1;
    this.lastRow = -1;
  }

  private drawLine(
    layer: Layer,
    c0: number, r0: number, c1: number, r1: number,
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
      layer.setTile(cc, rr, 0);
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
