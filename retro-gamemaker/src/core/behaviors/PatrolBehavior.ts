/**
 * PatrolBehavior — configuration and runtime logic for patrolling entities.
 *
 * An entity with patrol behavior moves back and forth along a direction
 * within a configurable tile range.
 */

import { Entity } from '../Entity';
import { EntityProperties } from '../EntityType';

export interface PatrolState {
  direction: number; // 1 or -1
  originX: number;
  originY: number;
  timer: number;
}

/** Create initial patrol state from an entity's properties. */
export function createPatrolState(entity: Entity): PatrolState {
  return {
    direction: 1,
    originX: entity.x,
    originY: entity.y,
    timer: 0,
  };
}

/** Get the effective speed (pixels per tick). */
export function getPatrolSpeed(props: EntityProperties): number {
  return props.speed ?? 1;
}

/** Get the patrol range in pixels. */
export function getPatrolRangePx(props: EntityProperties, tileSize: number): number {
  return (props.patrolRange ?? 3) * tileSize;
}

/** Get the movement axis. */
export function isHorizontal(props: EntityProperties): boolean {
  return props.direction !== 'vertical';
}
