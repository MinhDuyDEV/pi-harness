/**
 * Physics — basic physics for player movement with collision resolution.
 *
 * Uses a simple approach: apply velocity, then resolve collisions against
 * solid tiles. No gravity by default (top-down style); gravity can be enabled.
 */

import { Tilemap } from '../core/Tilemap';
import { Collision } from './Collision';

export interface PhysicsBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  /** If true, gravity is applied each frame */
  useGravity?: boolean;
  onGround?: boolean;
}

export class Physics {
  static GRAVITY = 980; // px/s²
  static PLAYER_SPEED = 120; // px/s
  static JUMP_VELOCITY = -280; // px/s

  /**
   * Update a physics body for one frame.
   * @param body  The physics body (mutated in place)
   * @param dt    Delta time in seconds
   * @param tilemap The tilemap for collision
   * @param inputLeft  Is left pressed?
   * @param inputRight Is right pressed?
   * @param inputUp    Is up/jump pressed?
   * @param inputDown  Is down pressed?
   */
  static update(
    body: PhysicsBody,
    dt: number,
    tilemap: Tilemap,
    inputLeft: boolean,
    inputRight: boolean,
    inputUp: boolean,
    inputDown: boolean,
  ): void {
    // Horizontal movement
    if (inputLeft) body.vx = -Physics.PLAYER_SPEED;
    else if (inputRight) body.vx = Physics.PLAYER_SPEED;
    else body.vx = 0;

    // Vertical movement
    if (body.useGravity) {
      // Platformer mode
      body.vy += Physics.GRAVITY * dt;
      if (body.vy > 600) body.vy = 600;

      if (inputUp && body.onGround) {
        body.vy = Physics.JUMP_VELOCITY;
        body.onGround = false;
      }
    } else {
      // Top-down mode
      if (inputUp) body.vy = -Physics.PLAYER_SPEED;
      else if (inputDown) body.vy = Physics.PLAYER_SPEED;
      else body.vy = 0;
    }

    // Apply velocity
    let newX = body.x + body.vx * dt;
    let newY = body.y + body.vy * dt;

    // Clamp to map bounds
    const maxX = tilemap.pixelWidth - body.width;
    const maxY = tilemap.pixelHeight - body.height;
    newX = Math.max(0, Math.min(maxX, newX));
    newY = Math.max(0, Math.min(maxY, newY));

    // Resolve collisions (separate X and Y for sliding)
    // Try X movement
    const resolvedX = Collision.resolve(tilemap, newX, body.y, body.width, body.height);
    if (resolvedX.x !== newX) {
      body.vx = 0; // Hit a wall
    }
    newX = resolvedX.x;

    // Try Y movement
    const resolvedY = Collision.resolve(tilemap, body.x, newY, body.width, body.height);
    if (resolvedY.y !== newY) {
      body.vy = 0;
      if (body.vy > 0) body.onGround = true;
    }
    newY = resolvedY.y;

    // Final resolve (both axes)
    const final = Collision.resolve(tilemap, newX, newY, body.width, body.height);
    body.x = final.x;
    body.y = final.y;

    // Check if on ground
    if (body.useGravity) {
      const below = Collision.resolve(tilemap, body.x, body.y + 1, body.width, body.height);
      body.onGround = below.y === body.y;
    }
  }
}
