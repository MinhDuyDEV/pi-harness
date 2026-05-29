/**
 * PNGImporter — imports PNG spritesheets, auto-detects or uses custom
 * grid sizes, and splits them into individual Sprite objects.
 */

import { Sprite } from '../core/Sprite';

export interface ImportedSprite {
  sprite: Sprite;
  /** Tile position in the spritesheet grid */
  col: number;
  row: number;
}

export interface AutoDetectResult {
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
}

export class PNGImporter {
  /**
   * Load a PNG file as an ImageBitmap.
   */
  static async loadFile(file: File): Promise<ImageBitmap> {
    const blob = new Blob([file], { type: file.type });
    const img = await createImageBitmap(blob);
    return img;
  }

  /**
   * Auto-detect the sprite grid from an image.
   * Tries common cell sizes (8, 16, 24, 32) and returns the smallest
   * that divides evenly into the image dimensions.
   */
  static autoDetectGrid(
    imageWidth: number,
    imageHeight: number,
  ): AutoDetectResult | null {
    const commonSizes = [8, 16, 24, 32];
    for (const size of commonSizes) {
      if (imageWidth % size === 0 && imageHeight % size === 0) {
        return {
          cellWidth: size,
          cellHeight: size,
          cols: imageWidth / size,
          rows: imageHeight / size,
        };
      }
    }
    // Try non-square detection
    for (const cw of commonSizes) {
      for (const ch of commonSizes) {
        if (imageWidth % cw === 0 && imageHeight % ch === 0) {
          return {
            cellWidth: cw,
            cellHeight: ch,
            cols: imageWidth / cw,
            rows: imageHeight / ch,
          };
        }
      }
    }
    return null;
  }

  /**
   * Split an image into sprites using a grid.
   * Quantises colours to the nearest palette entry (index 0 = transparent).
   * @param image       Source image
   * @param cellWidth   Width of each sprite in pixels
   * @param cellHeight  Height of each sprite in pixels
   * @param palette     Project palette (hex strings) — colours will be quantised to these
   * @returns Array of imported sprites with their grid positions
   */
  static splitGrid(
    image: ImageBitmap,
    cellWidth: number,
    cellHeight: number,
    palette: string[],
  ): ImportedSprite[] {
    const cols = Math.floor(image.width / cellWidth);
    const rows = Math.floor(image.height / cellHeight);
    const result: ImportedSprite[] = [];

    // Draw full image to a canvas to get pixel data
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = image.width;
    fullCanvas.height = image.height;
    const fullCtx = fullCanvas.getContext('2d')!;
    fullCtx.drawImage(image, 0, 0);
    const fullData = fullCtx.getImageData(0, 0, image.width, image.height);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sprite = new Sprite(cellWidth, cellHeight);
        const ox = col * cellWidth;
        const oy = row * cellHeight;

        for (let py = 0; py < cellHeight; py++) {
          for (let px = 0; px < cellWidth; px++) {
            const srcIdx = ((oy + py) * image.width + (ox + px)) * 4;
            const r = fullData.data[srcIdx];
            const g = fullData.data[srcIdx + 1];
            const b = fullData.data[srcIdx + 2];
            const a = fullData.data[srcIdx + 3];

            if (a < 128) {
              sprite.setPixel(px, py, 0); // transparent
            } else {
              const nearest = PNGImporter._nearestPaletteIndex(r, g, b, palette);
              sprite.setPixel(px, py, nearest);
            }
          }
        }

        result.push({ sprite, col, row });
      }
    }

    return result;
  }

  /**
   * Find the nearest palette index for an RGB colour.
   * Index 0 is transparent (never matched for opaque pixels).
   */
  private static _nearestPaletteIndex(
    r: number, g: number, b: number,
    palette: string[],
  ): number {
    let bestIdx = 1;
    let bestDist = Infinity;

    for (let i = 0; i < palette.length; i++) {
      const hex = palette[i];
      const pr = parseInt(hex.slice(1, 3), 16);
      const pg = parseInt(hex.slice(3, 5), 16);
      const pb = parseInt(hex.slice(5, 7), 16);
      const dr = r - pr;
      const dg = g - pg;
      const db = b - pb;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1; // palette is 0-indexed, but index 0 = transparent
      }
    }

    return bestIdx;
  }
}
