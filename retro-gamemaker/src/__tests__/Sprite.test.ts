import { describe, it, expect } from 'vitest';
import { Sprite } from '../core/Sprite';

describe('Sprite', () => {
  it('creates a blank sprite with all transparent pixels', () => {
    const s = new Sprite(16, 16);
    expect(s.width).toBe(16);
    expect(s.height).toBe(16);
    expect(s.pixels.length).toBe(256);
    expect(s.isEmpty()).toBe(true);
    expect(s.getPixel(0, 0)).toBe(Sprite.TRANSPARENT);
  });

  it('rejects invalid dimensions', () => {
    expect(() => new Sprite(0, 16)).toThrow();
    expect(() => new Sprite(16, 0)).toThrow();
    expect(() => new Sprite(300, 16)).toThrow();
    expect(() => new Sprite(16, -1)).toThrow();
  });

  it('rejects mismatched pixel array length', () => {
    expect(() => new Sprite(8, 8, new Uint8Array(60))).toThrow();
  });

  it('sets and gets pixels', () => {
    const s = new Sprite(8, 8);
    expect(s.setPixel(0, 0, 1)).toBe(true);
    expect(s.getPixel(0, 0)).toBe(1);
    expect(s.isEmpty()).toBe(false);
  });

  it('returns 0 for out-of-bounds getPixel', () => {
    const s = new Sprite(8, 8);
    expect(s.getPixel(-1, 0)).toBe(0);
    expect(s.getPixel(8, 0)).toBe(0);
    expect(s.getPixel(0, 8)).toBe(0);
  });

  it('returns false for out-of-bounds setPixel', () => {
    const s = new Sprite(8, 8);
    expect(s.setPixel(-1, 0, 1)).toBe(false);
    expect(s.setPixel(8, 0, 1)).toBe(false);
  });

  it('fills a rectangle', () => {
    const s = new Sprite(8, 8);
    s.fillRect(2, 2, 4, 4, 1);
    expect(s.getPixel(0, 0)).toBe(0); // outside
    expect(s.getPixel(3, 3)).toBe(1); // inside
    expect(s.getPixel(5, 5)).toBe(1); // inside
    expect(s.getPixel(6, 6)).toBe(0); // outside
  });

  it('clones correctly', () => {
    const s = new Sprite(4, 4);
    s.setPixel(1, 1, 2);
    const clone = s.clone();
    expect(clone.getPixel(1, 1)).toBe(2);
    clone.setPixel(1, 1, 3);
    expect(s.getPixel(1, 1)).toBe(2); // original unchanged
  });

  it('resizes preserving content at origin', () => {
    const s = new Sprite(4, 4);
    s.setPixel(0, 0, 1);
    s.setPixel(3, 3, 2);
    const resized = s.resize(8, 8);
    expect(resized.width).toBe(8);
    expect(resized.height).toBe(8);
    expect(resized.getPixel(0, 0)).toBe(1); // preserved
    expect(resized.getPixel(3, 3)).toBe(2); // preserved
    expect(resized.getPixel(7, 7)).toBe(0); // new area transparent
  });

  it('generates ImageData from palette', () => {
    const s = new Sprite(2, 2);
    s.setPixel(0, 0, 1);
    s.setPixel(1, 1, 2);
    // Palette array is 0-indexed: palette[1] = first actual colour
    const palette = ['#000000', '#ff0000', '#00ff00'];
    const imageData = s.toImageData(palette);
    expect(imageData.width).toBe(2);
    expect(imageData.height).toBe(2);

    // Pixel (0,0) = index 1 → palette[1] = #ff0000 → r=255
    expect(imageData.data[0]).toBe(255);
    expect(imageData.data[1]).toBe(0);
    expect(imageData.data[2]).toBe(0);
    expect(imageData.data[3]).toBe(255);

    // Pixel (1,1) = index 2 → palette[2] = #00ff00 → g=255
    const base = (1 * 2 + 1) * 4; // row 1, col 1
    expect(imageData.data[base]).toBe(0);
    expect(imageData.data[base + 1]).toBe(255);
    expect(imageData.data[base + 2]).toBe(0);
  });

  it('detects empty sprite', () => {
    expect(new Sprite(4, 4).isEmpty()).toBe(true);
    const s = new Sprite(4, 4);
    s.setPixel(0, 0, 1);
    expect(s.isEmpty()).toBe(false);
  });

  it('checks power of two', () => {
    const s = new Sprite(16, 16);
    expect(s.isPowerOfTwo(1)).toBe(true);
    expect(s.isPowerOfTwo(16)).toBe(true);
    expect(s.isPowerOfTwo(3)).toBe(false);
    expect(s.isPowerOfTwo(0)).toBe(false);
  });
});
