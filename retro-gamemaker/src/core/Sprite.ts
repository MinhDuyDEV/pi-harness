/**
 * Sprite — pixel data stored as indexed palette values in a flat Uint8Array.
 *
 * Index 0 is reserved as the transparent/background colour. Every cell holds
 * a palette index (0–255). The sprite is immutable from the outside; mutations
 * go through setPixel / fillRect and return boolean success.
 */

export class Sprite {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  /** Index 0 = transparent/eraser */
  static readonly TRANSPARENT = 0;

  constructor(width: number, height: number, pixels?: Uint8Array) {
    if (!Number.isInteger(width) || width < 1 || width > 256)
      throw new Error(`Invalid sprite width: ${width}`);
    if (!Number.isInteger(height) || height < 1 || height > 256)
      throw new Error(`Invalid sprite height: ${height}`);

    this.width = width;
    this.height = height;

    if (pixels) {
      if (pixels.length !== width * height)
        throw new Error(`Pixel array length ${pixels.length} does not match ${width}×${height}`);
      this.pixels = new Uint8Array(pixels);
    } else {
      this.pixels = new Uint8Array(width * height); // all zero (transparent)
    }
  }

  /** Create a deep clone of this sprite. */
  clone(): Sprite {
    return new Sprite(this.width, this.height, this.pixels);
  }

  /** Get the palette index at (x, y). Returns 0 (transparent) if out of bounds. */
  getPixel(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    return this.pixels[y * this.width + x];
  }

  /** Set the palette index at (x, y). Returns true if in bounds. */
  setPixel(x: number, y: number, colourIndex: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    this.pixels[y * this.width + x] = colourIndex;
    return true;
  }

  /** Fill a rectangle with a palette index. */
  fillRect(
    x: number, y: number, w: number, h: number, colourIndex: number,
  ): void {
    const x1 = Math.max(0, x);
    const y1 = Math.max(0, y);
    const x2 = Math.min(this.width, x + w);
    const y2 = Math.min(this.height, y + h);
    for (let cy = y1; cy < y2; cy++) {
      const row = cy * this.width;
      for (let cx = x1; cx < x2; cx++) {
        this.pixels[row + cx] = colourIndex;
      }
    }
  }

  /** Resize the sprite. Existing pixels are preserved at (0,0); new cells are transparent. */
  resize(newWidth: number, newHeight: number): Sprite {
    const result = new Sprite(newWidth, newHeight);
    const copyW = Math.min(this.width, newWidth);
    const copyH = Math.min(this.height, newHeight);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        result.pixels[y * newWidth + x] = this.pixels[y * this.width + x];
      }
    }
    return result;
  }

  /** Render the sprite to an RGBA ImageData using the provided palette colours. */
  toImageData(palette: string[]): ImageData {
    const imageData = new ImageData(this.width, this.height);
    for (let i = 0; i < this.pixels.length; i++) {
      const idx = this.pixels[i];
      const base = i * 4;
      if (idx === 0 || idx >= palette.length) {
        // Transparent
        imageData.data[base] = 0;
        imageData.data[base + 1] = 0;
        imageData.data[base + 2] = 0;
        imageData.data[base + 3] = 0;
      } else {
        const hex = palette[idx];
        imageData.data[base] = parseInt(hex.slice(1, 3), 16);
        imageData.data[base + 1] = parseInt(hex.slice(3, 5), 16);
        imageData.data[base + 2] = parseInt(hex.slice(5, 7), 16);
        imageData.data[base + 3] = 255;
      }
    }
    return imageData;
  }

  /** Resize the sprite to power-of-two dimensions while preserving content at (0,0). */
  isPowerOfTwo(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
  }

  /** Check if the sprite is entirely empty (all transparent). */
  isEmpty(): boolean {
    for (let i = 0; i < this.pixels.length; i++) {
      if (this.pixels[i] !== 0) return false;
    }
    return true;
  }
}
