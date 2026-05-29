/**
 * Vitest setup — provides browser APIs not included in jsdom.
 */
import { JSDOM } from 'jsdom';

// Polyfill ImageData (not available in jsdom)
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(sw: number, sh: number) {
      this.width = sw;
      this.height = sh;
      this.data = new Uint8ClampedArray(sw * sh * 4);
    }
  };
}
