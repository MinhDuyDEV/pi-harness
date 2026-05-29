/**
 * Layer — a single 2D tile grid with visibility and opacity controls.
 *
 * Each cell stores a tile palette index (0 = empty/no tile).
 */

export class Layer {
  name: string;
  width: number;
  height: number;
  tiles: Uint16Array;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0 … 1

  constructor(
    width: number,
    height: number,
    name: string = 'Layer',
    tiles?: Uint16Array,
  ) {
    this.width = width;
    this.height = height;
    this.name = name;
    this.visible = true;
    this.locked = false;
    this.opacity = 1;

    if (tiles) {
      if (tiles.length !== width * height)
        throw new Error(`Tile array length ${tiles.length} does not match ${width}×${height}`);
      this.tiles = new Uint16Array(tiles);
    } else {
      this.tiles = new Uint16Array(width * height);
    }
  }

  /** Get the tile index at (col, row). Returns 0 (empty) if out of bounds. */
  getTile(col: number, row: number): number {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return 0;
    return this.tiles[row * this.width + col];
  }

  /** Set the tile index at (col, row). Returns true if in bounds. */
  setTile(col: number, row: number, tileIndex: number): boolean {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return false;
    this.tiles[row * this.width + col] = tileIndex;
    return true;
  }

  /** Fill a rectangular region with a tile index. */
  fillRect(col: number, row: number, w: number, h: number, tileIndex: number): void {
    const x1 = Math.max(0, col);
    const y1 = Math.max(0, row);
    const x2 = Math.min(this.width, col + w);
    const y2 = Math.min(this.height, row + h);
    for (let cy = y1; cy < y2; cy++) {
      const offset = cy * this.width;
      for (let cx = x1; cx < x2; cx++) {
        this.tiles[offset + cx] = tileIndex;
      }
    }
  }

  /** Clones the layer with a copied tile buffer. */
  clone(name?: string): Layer {
    const l = new Layer(this.width, this.height, name ?? this.name, this.tiles);
    l.visible = this.visible;
    l.locked = this.locked;
    l.opacity = this.opacity;
    return l;
  }

  /** Resize the grid. Existing tiles are preserved at (0,0); new cells are 0 (empty). */
  resize(newWidth: number, newHeight: number): Layer {
    const result = new Layer(newWidth, newHeight, this.name);
    const copyW = Math.min(this.width, newWidth);
    const copyH = Math.min(this.height, newHeight);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        result.tiles[y * newWidth + x] = this.tiles[y * this.width + x];
      }
    }
    result.visible = this.visible;
    result.locked = this.locked;
    result.opacity = this.opacity;
    return result;
  }
}
