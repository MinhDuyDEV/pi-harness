import { describe, it, expect } from 'vitest';
import { Palette } from '../core/Palette';

describe('Palette', () => {
  it('creates an empty palette', () => {
    const p = new Palette();
    expect(p.length).toBe(0);
    expect(p.colours).toEqual([]);
  });

  it('creates a palette from colours', () => {
    const p = new Palette(['#ff0000', '#00ff00']);
    expect(p.length).toBe(2);
    expect(p.getColour(1)).toBe('#ff0000');
    expect(p.getColour(2)).toBe('#00ff00');
  });

  it('adds a colour and returns 1-based index', () => {
    const p = new Palette();
    expect(p.addColour('#ff0000')).toBe(1);
    expect(p.addColour('#00ff00')).toBe(2);
    expect(p.length).toBe(2);
  });

  it('inserts a colour at a specific position', () => {
    const p = new Palette(['#ff0000', '#00ff00']);
    p.insertColour('#0000ff', 2);
    expect(p.getColour(1)).toBe('#ff0000');
    expect(p.getColour(2)).toBe('#0000ff');
    expect(p.getColour(3)).toBe('#00ff00');
  });

  it('removes a colour by 1-based index', () => {
    const p = new Palette(['#ff0000', '#00ff00', '#0000ff']);
    const removed = p.removeColour(2);
    expect(removed).toBe('#00ff00');
    expect(p.length).toBe(2);
    expect(p.getColour(2)).toBe('#0000ff');
  });

  it('returns undefined for out-of-range removeColour', () => {
    const p = new Palette(['#ff0000']);
    expect(p.removeColour(0)).toBeUndefined();
    expect(p.removeColour(2)).toBeUndefined();
  });

  it('moves a colour from one index to another', () => {
    const p = new Palette(['#ff0000', '#00ff00', '#0000ff']);
    p.moveColour(1, 3);
    expect(p.getColour(1)).toBe('#00ff00');
    expect(p.getColour(2)).toBe('#0000ff');
    expect(p.getColour(3)).toBe('#ff0000');
  });

  it('sets a colour at a specific index', () => {
    const p = new Palette(['#ff0000', '#00ff00']);
    p.setColour(1, '#0000ff');
    expect(p.getColour(1)).toBe('#0000ff');
  });

  it('silently ignores setColour for out-of-range', () => {
    const p = new Palette(['#ff0000']);
    p.setColour(5, '#00ff00');
    expect(p.length).toBe(1);
  });

  it('clones independently', () => {
    const p = new Palette(['#ff0000']);
    const clone = p.clone();
    clone.addColour('#00ff00');
    expect(p.length).toBe(1);
    expect(clone.length).toBe(2);
  });

  it('loads colours from an array', () => {
    const p = new Palette();
    p.load(['#ff0000', '#00ff00']);
    expect(p.length).toBe(2);
  });

  it('serializes to JSON', () => {
    const p = new Palette(['#ff0000', '#00ff00']);
    expect(p.toJSON()).toEqual(['#ff0000', '#00ff00']);
  });
});
