import { describe, it, expect } from 'vitest';
import { Tilemap } from '../core/Tilemap';
import { Collision } from '../runtime/Collision';

describe('Collision', () => {
  function makeMap(): Tilemap {
    const tm = new Tilemap(10, 10, 16);
    // Mark some tiles solid: a wall at col 5, rows 3-6
    for (let row = 3; row <= 6; row++) {
      tm.collision.setSolid(5, row, true);
    }
    // Ground at row 8
    for (let col = 0; col < 10; col++) {
      tm.collision.setSolid(col, 8, true);
    }
    return tm;
  }

  it('detects solid tiles', () => {
    const tm = makeMap();
    expect(Collision.isSolidTile(tm, 5, 3)).toBe(true);
    expect(Collision.isSolidTile(tm, 0, 0)).toBe(false);
    expect(Collision.isSolidTile(tm, -1, 0)).toBe(true); // out of bounds
    expect(Collision.isSolidTile(tm, 20, 20)).toBe(true); // out of bounds
  });

  it('checkRect detects collision with wall', () => {
    const tm = makeMap();
    // Rect at the wall position
    const result = Collision.checkRect(tm, 5 * 16, 3 * 16, 16, 16);
    expect(result.collides).toBe(true);
  });

  it('checkRect returns no collision in open space', () => {
    const tm = makeMap();
    const result = Collision.checkRect(tm, 0, 0, 16, 16);
    expect(result.collides).toBe(false);
    expect(result.top).toBe(false);
    expect(result.bottom).toBe(false);
    expect(result.left).toBe(false);
    expect(result.right).toBe(false);
  });

  it('resolve pushes entity out of solid tiles', () => {
    const tm = makeMap();
    // Place entity overlapping the wall
    const result = Collision.resolve(tm, 5 * 16 - 4, 3 * 16, 16, 16);
    expect(result.x).toBeLessThan(5 * 16); // pushed left
    expect(result.y).toBe(3 * 16); // y unchanged
  });

  it('resolve pushes entity upward when landing on ground', () => {
    const tm = makeMap();
    // Entity slightly overlapping ground from above
    const result = Collision.resolve(tm, 0, 8 * 16 - 8, 16, 16);
    expect(result.y).toBe(8 * 16 - 16); // pushed up
  });

  it('resolve handles multi-tile collisions', () => {
    const tm = makeMap();
    // Large rect that overlaps the wall (col 5 at x=80) and ground (row 8 at y=128)
    // Place rect at left side of wall, overlapping into it
    const result = Collision.resolve(tm, 5 * 16 - 4, 8 * 16 - 4, 16, 20);
    // Should be pushed left (the wall) or up (the ground) - whichever has smallest overlap
    expect(result.x).toBeLessThan(5 * 16);
  });
});
