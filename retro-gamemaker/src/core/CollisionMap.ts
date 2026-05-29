/**
 * CollisionMap — a boolean grid marking tiles as solid (blocking) or passable.
 *
 * Stored as a Uint8Array (0 = passable, 1 = solid). Rendered as a coloured
 * overlay in the tilemap editor.
 */

export class CollisionMap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, data?: Uint8Array) {
    this.width = width;
    this.height = height;

    if (data) {
      if (data.length !== width * height)
        throw new Error(`Collision data length ${data.length} does not match ${width}×${height}`);
      this.data = new Uint8Array(data);
    } else {
      this.data = new Uint8Array(width * height);
    }
  }

  /** Returns true if the tile at (col, row) is solid. Out of bounds → solid. */
  isSolid(col: number, row: number): boolean {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return true;
    return this.data[row * this.width + col] !== 0;
  }

  /** Mark a tile as solid (true) or passable (false). */
  setSolid(col: number, row: number, solid: boolean): void {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return;
    this.data[row * this.width + col] = solid ? 1 : 0;
  }

  /** Fill a rectangular region with solid or passable. */
  fillRect(col: number, row: number, w: number, h: number, solid: boolean): void {
    const x1 = Math.max(0, col);
    const y1 = Math.max(0, row);
    const x2 = Math.min(this.width, col + w);
    const y2 = Math.min(this.height, row + h);
    const val = solid ? 1 : 0;
    for (let cy = y1; cy < y2; cy++) {
      const offset = cy * this.width;
      for (let cx = x1; cx < x2; cx++) {
        this.data[offset + cx] = val;
      }
    }
  }

  /** Create a deep clone. */
  clone(): CollisionMap {
    return new CollisionMap(this.width, this.height, this.data);
  }

  /** Resize the grid. Existing data preserved at (0,0); new cells are passable (0). */
  resize(newWidth: number, newHeight: number): CollisionMap {
    const result = new CollisionMap(newWidth, newHeight);
    const copyW = Math.min(this.width, newWidth);
    const copyH = Math.min(this.height, newHeight);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        result.data[y * newWidth + x] = this.data[y * this.width + x];
      }
    }
    return result;
  }
}
