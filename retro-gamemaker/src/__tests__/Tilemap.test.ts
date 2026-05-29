import { describe, it, expect } from 'vitest';
import { Tilemap } from '../core/Tilemap';
import { Layer } from '../core/Layer';
import { Entity } from '../core/Entity';

describe('Tilemap', () => {
  it('creates a default tilemap', () => {
    const tm = new Tilemap();
    expect(tm.width).toBe(32);
    expect(tm.height).toBe(32);
    expect(tm.tileSize).toBe(16);
    expect(tm.layers.length).toBe(2);
    expect(tm.tilePalette).toEqual([null]);
    expect(tm.entities).toEqual([]);
  });

  it('computes pixel dimensions', () => {
    const tm = new Tilemap(16, 20, 8);
    expect(tm.pixelWidth).toBe(128);
    expect(tm.pixelHeight).toBe(160);
  });

  it('adds and removes layers', () => {
    const tm = new Tilemap(16, 16);
    const layer = tm.addLayer('Extra');
    expect(tm.layers.length).toBe(3);
    expect(layer.name).toBe('Extra');

    const removed = tm.removeLayer(2);
    expect(removed?.name).toBe('Extra');
    expect(tm.layers.length).toBe(2);
  });

  it('moves layers (reorder)', () => {
    const tm = new Tilemap(16, 16);
    const l0 = tm.layers[0];
    const l1 = tm.layers[1];
    tm.moveLayer(0, 1);
    expect(tm.layers[0]).toBe(l1);
    expect(tm.layers[1]).toBe(l0);
  });

  it('adds and removes tiles from palette', () => {
    const tm = new Tilemap(16, 16);
    const idx1 = tm.addTileToPalette({ spriteIndex: 0, label: 'Tile1' });
    expect(idx1).toBe(1);
    expect(tm.paletteSize).toBe(1);

    const idx2 = tm.addTileToPalette({ spriteIndex: 1 });
    expect(idx2).toBe(2);

    tm.removeTileFromPalette(1);
    expect(tm.paletteSize).toBe(1);
    expect(tm.tilePalette[1]?.spriteIndex).toBe(1); // shifted down
  });

  it('resizes preserving content', () => {
    const tm = new Tilemap(16, 16);
    tm.layers[0].setTile(0, 0, 1);
    tm.resize(32, 32);
    expect(tm.width).toBe(32);
    expect(tm.height).toBe(32);
    expect(tm.layers[0].getTile(0, 0)).toBe(1);
    expect(tm.layers[0].getTile(31, 31)).toBe(0); // new area
  });

  it('clones independently', () => {
    const tm = new Tilemap(16, 16);
    tm.addTileToPalette({ spriteIndex: 0 });
    tm.layers[0].setTile(0, 0, 1);
    tm.entities.push(new Entity('player-start', 0, 0));

    const clone = tm.clone();
    expect(clone.layers[0].getTile(0, 0)).toBe(1);
    expect(clone.entities.length).toBe(1);
    expect(clone.tilePalette[1]?.spriteIndex).toBe(0);

    // Mutation doesn't affect original
    clone.layers[0].setTile(0, 0, 2);
    expect(tm.layers[0].getTile(0, 0)).toBe(1);
  });

  it('enforces max entities', () => {
    const tm = new Tilemap(16, 16);
    for (let i = 0; i < 500; i++) {
      expect(tm.addEntity(new Entity('static', i * 16, 0))).toBe(true);
    }
    expect(tm.canAddEntity).toBe(false);
    expect(tm.addEntity(new Entity('static', 0, 0))).toBe(false);
  });

  it('adds and removes entities', () => {
    const tm = new Tilemap(16, 16);
    const e = new Entity('player-start', 32, 32);
    tm.addEntity(e);
    expect(tm.entities.length).toBe(1);
    expect(tm.removeEntity(e.id)).toBe(true);
    expect(tm.entities.length).toBe(0);
    expect(tm.removeEntity('nonexistent')).toBe(false);
  });

  it('clears all layers', () => {
    const tm = new Tilemap(16, 16);
    tm.layers[0].setTile(0, 0, 1);
    tm.collision.setSolid(0, 0, true);
    tm.clearAllLayers();
    expect(tm.layers[0].getTile(0, 0)).toBe(0);
    expect(tm.collision.isSolid(0, 0)).toBe(false);
  });
});
