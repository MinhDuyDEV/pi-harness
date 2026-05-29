/**
 * EntityPlaceTool — click-to-place entities on the tilemap.
 *
 * Creates a new Entity at the clicked pixel position using the active
 * entity type's default properties. Enforces the 500-entity maximum.
 */

import { Tilemap } from '../core/Tilemap';
import { Entity, MAX_ENTITIES } from '../core/Entity';
import { EntityType, EntityProperties } from '../core/EntityType';

export interface PlaceResult {
  entity: Entity;
  tilemap: Tilemap;
}

export class EntityPlaceTool {
  /**
   * Place a new entity of the given type at (pixelX, pixelY).
   * Returns the new entity and updated tilemap, or null if the map is full.
   */
  place(
    tilemap: Tilemap,
    type: EntityType,
    pixelX: number,
    pixelY: number,
  ): PlaceResult | null {
    if (tilemap.entities.length >= MAX_ENTITIES) return null;

    const entity = new Entity(
      type.id,
      pixelX,
      pixelY,
      { ...type.defaultProperties } as EntityProperties,
    );

    const clone = tilemap.clone();
    clone.entities.push(entity);
    return { entity, tilemap: clone };
  }

  /**
   * Remove an entity by id from a tilemap.
   */
  remove(tilemap: Tilemap, entityId: string): Tilemap | null {
    const idx = tilemap.entities.findIndex((e) => e.id === entityId);
    if (idx === -1) return null;
    const clone = tilemap.clone();
    clone.entities.splice(idx, 1);
    return clone;
  }

  /**
   * Update an entity's position.
   */
  move(tilemap: Tilemap, entityId: string, x: number, y: number): Tilemap | null {
    const clone = tilemap.clone();
    const entity = clone.entities.find((e) => e.id === entityId);
    if (!entity) return null;
    entity.x = Math.round(x);
    entity.y = Math.round(y);
    return clone;
  }

  /**
   * Find the entity at a given pixel position (within a snap radius).
   */
  findAt(
    tilemap: Tilemap,
    pixelX: number,
    pixelY: number,
    snapRadius: number = 16,
  ): Entity | undefined {
    // Search in reverse so topmost (last placed) entity is found first
    for (let i = tilemap.entities.length - 1; i >= 0; i--) {
      const e = tilemap.entities[i];
      const dx = e.x - pixelX;
      const dy = e.y - pixelY;
      if (Math.sqrt(dx * dx + dy * dy) <= snapRadius) return e;
    }
    return undefined;
  }
}
