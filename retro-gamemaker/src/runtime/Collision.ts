/**
 * Collision — AABB collision detection against the tilemap collision layer.
 *
 * Provides tile-based collision queries and rect-vs-tilemap checks.
 */

import { Tilemap } from '../core/Tilemap';

export interface CollisionResult {
  /** Did the rect collide with any solid tile? */
  collides: boolean;
  /** Which sides are blocked? */
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export class Collision {
  /**
   * Check if a tile at (col, row) is solid.
   */
  static isSolidTile(tilemap: Tilemap, col: number, row: number): boolean {
    return tilemap.collision.isSolid(col, row);
  }

  /**
   * Check if a world-space AABB overlaps any solid tile.
   * Returns which sides are blocked.
   */
  static checkRect(
    tilemap: Tilemap,
    x: number, y: number, w: number, h: number,
  ): CollisionResult {
    const ts = tilemap.tileSize;

    // Tiles the rect overlaps
    const col1 = Math.floor(x / ts);
    const row1 = Math.floor(y / ts);
    const col2 = Math.floor((x + w - 1) / ts);
    const row2 = Math.floor((y + h - 1) / ts);

    let collides = false;
    let top = false;
    let bottom = false;
    let left = false;
    let right = false;

    for (let row = row1; row <= row2; row++) {
      for (let col = col1; col <= col2; col++) {
        if (!this.isSolidTile(tilemap, col, row)) continue;
        collides = true;

        // Determine which edge of the rect contacts the tile
        const tileLeft = col * ts;
        const tileRight = tileLeft + ts;
        const tileTop = row * ts;
        const tileBottom = tileTop + ts;

        const overlapLeft = (x + w) - tileLeft;
        const overlapRight = tileRight - x;
        const overlapTop = (y + h) - tileTop;
        const overlapBottom = tileBottom - y;

        // Find the smallest overlap — that's the collision side
        const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

        if (minOverlap === overlapLeft) right = true;
        else if (minOverlap === overlapRight) left = true;
        else if (minOverlap === overlapTop) bottom = true;
        else if (minOverlap === overlapBottom) top = true;
      }
    }

    return { collides, top, bottom, left, right };
  }

  /**
   * Resolve a moving rect against solid tiles.
   * Mutates x, y to push the rect out of solid tiles.
   */
  static resolve(
    tilemap: Tilemap,
    x: number, y: number, w: number, h: number,
  ): { x: number; y: number } {
    const ts = tilemap.tileSize;

    // Check all four corners and edges
    const col1 = Math.floor(x / ts);
    const row1 = Math.floor(y / ts);
    const col2 = Math.floor((x + w - 0.01) / ts);
    const row2 = Math.floor((y + h - 0.01) / ts);

    for (let row = row1; row <= row2; row++) {
      for (let col = col1; col <= col2; col++) {
        if (!this.isSolidTile(tilemap, col, row)) continue;

        const tileLeft = col * ts;
        const tileRight = tileLeft + ts;
        const tileTop = row * ts;
        const tileBottom = tileTop + ts;

        // Compute overlap on each axis
        const overlapLeft = (x + w) - tileLeft;
        const overlapRight = tileRight - x;
        const overlapTop = (y + h) - tileTop;
        const overlapBottom = tileBottom - y;

        // Push out along the axis with smallest overlap
        const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

        if (minOverlap === overlapLeft) {
          x = tileLeft - w;
        } else if (minOverlap === overlapRight) {
          x = tileRight;
        } else if (minOverlap === overlapTop) {
          y = tileTop - h;
        } else if (minOverlap === overlapBottom) {
          y = tileBottom;
        }
      }
    }

    return { x, y };
  }
}
