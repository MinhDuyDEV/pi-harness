/**
 * EntityRunner — runs behavior logic for all entity types each frame.
 *
 * Updates patrol movement, checks collectible pickups, and fires trigger zones.
 * Mutates the runtime entity list and game state.
 */

import { Tilemap } from '../core/Tilemap';
import { Entity } from '../core/Entity';
import { EntityType } from '../core/EntityType';
import { Collision } from './Collision';

export interface GameState {
  score: number;
  health: number;
  playerX: number;
  playerY: number;
  playerW: number;
  playerH: number;
  /** Entities that have been collected (removed) */
  collected: Set<string>;
  /** Trigger zones that have been fired */
  firedTriggers: Set<string>;
  /** Patrol state: entity id → direction multiplier */
  patrolDir: Map<string, number>;
}

export class EntityRunner {
  /**
   * Update all entities for one frame.
   * @param dt Delta time in seconds
   */
  update(
    entities: Entity[],
    entityTypes: EntityType[],
    tilemap: Tilemap,
    state: GameState,
    dt: number,
  ): void {
    for (let i = entities.length - 1; i >= 0; i--) {
      const entity = entities[i];
      const type = entityTypes.find((t) => t.id === entity.typeId);
      if (!type) continue;

      switch (type.behaviorType) {
        case 'patrol':
          this.runPatrol(entity, type, tilemap, state, dt);
          break;
        case 'collectible':
          this.runCollectible(entity, type, state, entities, i);
          break;
        case 'trigger-zone':
          this.runTriggerZone(entity, type, state);
          break;
        case 'static':
        case 'spawn-point':
        case 'player-start':
          // No per-frame behavior for these in the runtime
          break;
      }
    }
  }

  private runPatrol(
    entity: Entity,
    _type: EntityType,
    tilemap: Tilemap,
    state: GameState,
    dt: number,
  ): void {
    const dir = state.patrolDir.get(entity.id) ?? 1;
    const speed = (entity.properties.speed ?? 1) * 60; // px/s
    const range = (entity.properties.patrolRange ?? 3) * tilemap.tileSize;
    const isHorizontal = entity.properties.direction !== 'vertical';

    let dx = 0;
    let dy = 0;

    if (isHorizontal) {
      dx = dir * speed * dt;
    } else {
      dy = dir * speed * dt;
    }

    const newX = entity.x + dx;
    const newY = entity.y + dy;

    // Check if we've exceeded the patrol range from origin
    const distFromStart = isHorizontal
      ? Math.abs(newX - entity.x)
      : Math.abs(newY - entity.y);

    // Check collision at new position
    const hit = Collision.checkRect(tilemap, newX, newY, tilemap.tileSize, tilemap.tileSize);

    if (hit.collides || distFromStart > range) {
      // Reverse direction
      state.patrolDir.set(entity.id, -dir);
    } else {
      entity.x = newX;
      entity.y = newY;
    }
  }

  private runCollectible(
    entity: Entity,
    _type: EntityType,
    state: GameState,
    entities: Entity[],
    index: number,
  ): void {
    if (state.collected.has(entity.id)) {
      entities.splice(index, 1);
      return;
    }

    // Check player overlap
    const playerRect = {
      x: state.playerX,
      y: state.playerY,
      w: state.playerW,
      h: state.playerH,
    };

    const collectRect = {
      x: entity.x,
      y: entity.y,
      w: 16, // assume tileSize
      h: 16,
    };

    if (this.rectsOverlap(playerRect, collectRect)) {
      state.collected.add(entity.id);
      state.score += entity.properties.collectibleType === 'gem' ? 500 : 100;
      entities.splice(index, 1);
    }
  }

  private runTriggerZone(
    entity: Entity,
    _type: EntityType,
    state: GameState,
  ): void {
    if (state.firedTriggers.has(entity.id)) return;

    const radius = entity.properties.triggerRadius ?? 32;

    // Check if player is within radius
    const dx = state.playerX - entity.x;
    const dy = state.playerY - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= radius) {
      state.firedTriggers.add(entity.id);
      // Fire event - for now, log and add score as a demonstration
      state.score += 50; // bonus for discovering trigger
    }
  }

  private rectsOverlap(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }
}
