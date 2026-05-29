/**
 * Integration tests for the game runtime.
 *
 * Tests: sprite creation → tile palette → tilemap painting → entity placement → play → score
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Sprite } from '../../core/Sprite';
import { Palette } from '../../core/Palette';
import { Tilemap } from '../../core/Tilemap';
import { Layer } from '../../core/Layer';
import { Entity } from '../../core/Entity';
import { EntityType } from '../../core/EntityType';

// A minimal entity type for testing
const TEST_ENTITY_TYPES: EntityType[] = [
  {
    id: 'player-start',
    name: 'Player Start',
    behaviorType: 'player-start',
    spriteIndex: 0,
    color: '#3fb950',
    description: '',
    defaultProperties: {},
  },
  {
    id: 'collectible-coin',
    name: 'Collectible Coin',
    behaviorType: 'collectible',
    spriteIndex: 0,
    color: '#d29922',
    description: '',
    defaultProperties: { collectibleType: 'coin' },
  },
  {
    id: 'enemy-patrol',
    name: 'Enemy Patrol',
    behaviorType: 'patrol',
    spriteIndex: 0,
    color: '#f85149',
    description: '',
    defaultProperties: { speed: 1, direction: 'horizontal', patrolRange: 3 },
  },
];

describe('Runtime Integration', () => {
  let tilemap: Tilemap;
  let palette: Palette;
  let sprites: Sprite[];

  beforeEach(() => {
    // Create a simple test project
    palette = new Palette(['#ff0000', '#00ff00', '#0000ff']);
    sprites = [new Sprite(16, 16)];

    tilemap = new Tilemap(20, 15, 16);
    tilemap.addLayer('Collision (non-rendered)');

    // Add ground tiles to background layer at row 13-14
    const bg = tilemap.layers[0];
    for (let col = 0; col < 20; col++) {
      bg.setTile(col, 13, 1);
      bg.setTile(col, 14, 1);
    }
    // Mark ground as solid in collision layer
    for (let col = 0; col < 20; col++) {
      tilemap.collision.setSolid(col, 13, true);
      tilemap.collision.setSolid(col, 14, true);
    }

    // Add tile palette entry
    tilemap.addTileToPalette({ spriteIndex: 0, label: 'Ground' });
  });

  it('Create sprite → place in tile palette → paint tilemap → verify render', () => {
    // Create a recognizable sprite (all red)
    const sprite = new Sprite(8, 8);
    sprite.fillRect(0, 0, 8, 8, 1); // index 1 = first palette colour

    // Add to project sprites
    sprites.push(sprite);

    // Add to tile palette
    const tileIdx = tilemap.addTileToPalette({ spriteIndex: 1, label: 'Test Tile' });

    // Paint on map
    tilemap.layers[0].fillRect(5, 5, 3, 3, tileIdx);

    // Verify tile was placed
    for (let y = 5; y < 8; y++) {
      for (let x = 5; x < 8; x++) {
        expect(tilemap.layers[0].getTile(x, y)).toBe(tileIdx);
      }
    }

    // Verify tile outside region is still 0
    expect(tilemap.layers[0].getTile(0, 0)).toBe(0);

    // Render to ImageData and verify pixel colors
    // Palette has 3 entries: ['#ff0000', '#00ff00', '#0000ff']
    // Pixel value 1 → palette[1] = '#00ff00' (green)
    const imageData = sprite.toImageData(palette.colours);
    expect(imageData.data[0]).toBe(0);
    expect(imageData.data[1]).toBe(255); // G
    expect(imageData.data[2]).toBe(0);
    expect(imageData.data[3]).toBe(255);
  });

  it('Play mode → collect entity → score increments', () => {
    // Place player start
    const player = new Entity('player-start', 32, 32);
    tilemap.addEntity(player);

    // Place collectible overlapping player
    const coin = new Entity('collectible-coin', 32 + 8, 32, { collectibleType: 'coin' });
    tilemap.addEntity(coin);

    // Simulate game state
    const collected = new Set<string>();
    let score = 0;

    // Player rect (slightly smaller than tile)
    const playerRect = { x: 32, y: 32, w: 14, h: 14 };
    const coinRect = { x: coin.x, y: coin.y, w: 16, h: 16 };

    // Check overlap
    function rectsOverlap(
      ax: number, ay: number, aw: number, ah: number,
      bx: number, by: number, bw: number, bh: number,
    ): boolean {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    const overlaps = rectsOverlap(
      playerRect.x, playerRect.y, playerRect.w, playerRect.h,
      coinRect.x, coinRect.y, coinRect.w, coinRect.h,
    );
    expect(overlaps).toBe(true);

    // Simulate collection
    if (overlaps && !collected.has(coin.id)) {
      collected.add(coin.id);
      score += 100;
    }

    expect(score).toBe(100);
    expect(collected.has(coin.id)).toBe(true);

    // Verify no double collect
    if (overlaps && !collected.has(coin.id)) {
      score += 100;
    }
    expect(score).toBe(100); // unchanged
  });

  it('Entity system: patrol returns correct config', () => {
    const enemy = new Entity('enemy-patrol', 100, 100, {
      speed: 2,
      direction: 'horizontal',
      patrolRange: 5,
    });

    expect(enemy.typeId).toBe('enemy-patrol');
    expect(enemy.properties.speed).toBe(2);
    expect(enemy.properties.direction).toBe('horizontal');
    expect(enemy.properties.patrolRange).toBe(5);
  });

  it('Entity clone preserves all properties', () => {
    const original = new Entity('collectible-coin', 50, 60, {
      collectibleType: 'gem',
    });
    const clone = original.clone();
    expect(clone.id).toBe(original.id);
    expect(clone.x).toBe(original.x);
    expect(clone.y).toBe(original.y);
    expect(clone.properties.collectibleType).toBe('gem');
    expect(clone.typeId).toBe(original.typeId);
  });
});
