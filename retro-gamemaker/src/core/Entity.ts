/**
 * Entity — a placed instance on the tilemap.
 *
 * Each entity references an EntityType via typeId and holds
 * its pixel position and behavior-specific properties.
 *
 * Stored in the Tilemap.entities array. Max 500 per map.
 */

import { EntityProperties } from './EntityType';

let _nextId = 1;
function generateId(): string {
  return `ent_${Date.now().toString(36)}_${(_nextId++).toString(36)}`;
}

export const MAX_ENTITIES = 500;

export class Entity {
  readonly id: string;
  typeId: string;
  x: number; // pixel position (top-left)
  y: number;
  properties: EntityProperties;

  constructor(
    typeId: string,
    x: number,
    y: number,
    properties?: EntityProperties,
    id?: string,
  ) {
    this.id = id ?? generateId();
    this.typeId = typeId;
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.properties = properties ? { ...properties } : {};
  }

  /** Create a deep clone with the same id. */
  clone(): Entity {
    return new Entity(this.typeId, this.x, this.y, { ...this.properties }, this.id);
  }
}
