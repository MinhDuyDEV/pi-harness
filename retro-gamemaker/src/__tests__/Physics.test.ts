import { describe, it, expect } from 'vitest';
import { Tilemap } from '../core/Tilemap';
import { Physics, PhysicsBody } from '../runtime/Physics';

describe('Physics', () => {
  function makeMap(): Tilemap {
    const tm = new Tilemap(20, 20, 16);
    // Ground at row 18
    for (let col = 0; col < 20; col++) {
      tm.collision.setSolid(col, 18, true);
    }
    // Wall at col 10, rows 16-18
    for (let row = 16; row <= 18; row++) {
      tm.collision.setSolid(10, row, true);
    }
    return tm;
  }

  function makeBody(x: number, y: number): PhysicsBody {
    return {
      x, y, vx: 0, vy: 0,
      width: 14, height: 14,
      useGravity: false,
      onGround: false,
    };
  }

  it('moves player left', () => {
    const tm = makeMap();
    const body = makeBody(100, 100);
    Physics.update(body, 1 / 60, tm, true, false, false, false);
    expect(body.vx).toBe(-Physics.PLAYER_SPEED);
    expect(body.x).toBeLessThan(100);
  });

  it('moves player right', () => {
    const tm = makeMap();
    const body = makeBody(100, 100);
    Physics.update(body, 1 / 60, tm, false, true, false, false);
    expect(body.vx).toBe(Physics.PLAYER_SPEED);
    expect(body.x).toBeGreaterThan(100);
  });

  it('moves player up', () => {
    const tm = makeMap();
    const body = makeBody(100, 100);
    Physics.update(body, 1 / 60, tm, false, false, true, false);
    expect(body.vy).toBe(-Physics.PLAYER_SPEED);
    expect(body.y).toBeLessThan(100);
  });

  it('moves player down', () => {
    const tm = makeMap();
    const body = makeBody(100, 100);
    Physics.update(body, 1 / 60, tm, false, false, false, true);
    expect(body.vy).toBe(Physics.PLAYER_SPEED);
    expect(body.y).toBeGreaterThan(100);
  });

  it('stops player when no input', () => {
    const tm = makeMap();
    const body = makeBody(100, 100);
    body.vx = 100;
    Physics.update(body, 1 / 60, tm, false, false, false, false);
    expect(body.vx).toBe(0);
  });

  it('clamps player to map bounds', () => {
    const tm = makeMap();
    const body = makeBody(tm.pixelWidth - 5, 100);
    Physics.update(body, 1 / 60, tm, false, true, false, false);
    expect(body.x).toBeLessThanOrEqual(tm.pixelWidth - body.width);
  });

  it('resolves collision with wall', () => {
    const tm = makeMap();
    // Place player to the left of the wall, moving right
    const body = makeBody(10 * 16 - 10, 17 * 16);
    Physics.update(body, 1 / 60, tm, false, true, false, false);
    // Should not pass through wall
    expect(body.x + body.width).toBeLessThanOrEqual(10 * 16);
  });

  it('resolves collision with ground from above', () => {
    const tm = makeMap();
    const body = makeBody(50, 18 * 16 - 10);
    // Moving down
    Physics.update(body, 1 / 60, tm, false, false, false, true);
    // Should land on ground
    expect(body.y + body.height).toBeLessThanOrEqual(18 * 16);
  });

  it('applies gravity when useGravity is true', () => {
    const tm = makeMap();
    const body = makeBody(50, 50);
    body.useGravity = true;
    const initialVy = body.vy;
    Physics.update(body, 1 / 60, tm, false, false, false, false);
    expect(body.vy).toBeGreaterThan(initialVy); // gravity pulled down
  });
});
