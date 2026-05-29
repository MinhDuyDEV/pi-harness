/**
 * SpritePacker — converts project sprites into compact embeddable pixel data
 * for the exported HTML game.
 *
 * Each sprite is serialized as { w, h, pixels: number[] } where pixels are
 * palette indices (0 = transparent). The palette is embedded separately.
 */

import { Sprite } from '../core/Sprite';

export interface PackedSprite {
  w: number;
  h: number;
  p: number[]; // flat array of palette indices
}

export interface PackedData {
  palette: string[];
  sprites: PackedSprite[];
  tilemap: {
    w: number;
    h: number;
    ts: number;
    layers: Array<{ tiles: number[]; opacity: number }>;
    collision: number[];
    tilePalette: Array<{ si: number } | null>;
  };
  entities: Array<{
    ti: string;  // typeId
    x: number;
    y: number;
    props: Record<string, unknown>;
  }>;
  entityTypes: Array<{
    id: string;
    bt: string;   // behaviorType
    si: number;   // spriteIndex
    color: string;
    props: Record<string, unknown>;
  }>;
}

export class SpritePacker {
  /**
   * Pack project sprites into a compact format for embedding.
   * Strips unnecessary whitespace and uses short property names.
   */
  static pack(
    sprites: Sprite[],
    palette: string[],
    tilemap: import('../core/Tilemap').Tilemap,
    entities: import('../core/Entity').Entity[],
    entityTypes: import('../core/EntityType').EntityType[],
  ): PackedData {
    return {
      palette,
      sprites: sprites.map((s) => ({
        w: s.width,
        h: s.height,
        p: Array.from(s.pixels),
      })),
      tilemap: {
        w: tilemap.width,
        h: tilemap.height,
        ts: tilemap.tileSize,
        layers: tilemap.layers.map((l) => ({
          tiles: Array.from(l.tiles),
          opacity: l.visible ? l.opacity : 0,
        })),
        collision: Array.from(tilemap.collision.data),
        tilePalette: tilemap.tilePalette.map((e) =>
          e ? { si: e.spriteIndex } : null,
        ),
      },
      entities: entities.map((e) => ({
        ti: e.typeId,
        x: e.x,
        y: e.y,
        props: { ...e.properties },
      })),
      entityTypes: entityTypes.map((t) => ({
        id: t.id,
        bt: t.behaviorType,
        si: t.spriteIndex,
        color: t.color,
        props: { ...t.defaultProperties },
      })),
    };
  }

  /**
   * Estimate the size of the packed data in bytes.
   */
  static estimateSize(data: PackedData): number {
    const json = JSON.stringify(data);
    return new Blob([json]).size;
  }
}
