/**
 * ProjectSerializer — converts runtime Project state to/from JSON.
 *
 * Handles version migration so older save files can be loaded.
 */

import { Sprite } from './Sprite';
import { Palette } from './Palette';
import { Tilemap } from './Tilemap';
import { Layer } from './Layer';
import { CollisionMap } from './CollisionMap';
import { Entity } from './Entity';
import { EntityType, BehaviorType } from './EntityType';
import {
  ProjectJSON,
  PROJECT_FORMAT_VERSION,
  SerializedSprite,
  SerializedTilemap,
  generateProjectId,
} from './Project';

export interface ProjectData {
  id: string;
  name: string;
  author: string;
  createdAt: string;
  modifiedAt: string;
  palette: Palette;
  sprites: Sprite[];
  tilemap: Tilemap;
  entityTypes: EntityType[];
}

export class ProjectSerializer {
  /**
   * Serialize current project data to a JSON-safe object.
   */
  static toJSON(data: ProjectData): ProjectJSON {
    const now = new Date().toISOString();

    return {
      formatVersion: PROJECT_FORMAT_VERSION,
      meta: {
        id: data.id,
        name: data.name,
        author: data.author,
        createdAt: data.createdAt,
        modifiedAt: now,
      },
      palette: data.palette.toJSON(),
      sprites: data.sprites.map(ProjectSerializer._serializeSprite),
      entityTypes: data.entityTypes.map((t) => ({
        id: t.id,
        name: t.name,
        behaviorType: t.behaviorType,
        spriteIndex: t.spriteIndex,
        color: t.color,
        description: t.description,
        defaultProperties: { ...t.defaultProperties },
      })),
      tilemap: ProjectSerializer._serializeTilemap(data.tilemap),
    };
  }

  /**
   * Deserialize a JSON object back to runtime project data.
   */
  static fromJSON(json: ProjectJSON): ProjectData {
    const migrated = ProjectSerializer._migrate(json);

    const tilemapData = migrated.tilemap;
    const tilemap = ProjectSerializer._deserializeTilemap(tilemapData);

    const sprites = (migrated.sprites ?? []).map(ProjectSerializer._deserializeSprite);

    const palette = new Palette(migrated.palette ?? []);

    const entityTypes: EntityType[] = (migrated.entityTypes ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      behaviorType: t.behaviorType as BehaviorType,
      spriteIndex: t.spriteIndex ?? 0,
      color: t.color ?? '#888',
      description: t.description ?? '',
      defaultProperties: t.defaultProperties ?? {},
    }));

    return {
      id: migrated.meta.id,
      name: migrated.meta.name,
      author: migrated.meta.author ?? '',
      createdAt: migrated.meta.createdAt,
      modifiedAt: migrated.meta.modifiedAt,
      palette,
      sprites,
      tilemap,
      entityTypes,
    };
  }

  /**
   * Export project data as a downloadable JSON string.
   */
  static exportToFile(data: ProjectData): string {
    const json = ProjectSerializer.toJSON(data);
    return JSON.stringify(json, null, 2);
  }

  /**
   * Parse an imported JSON string into project data.
   */
  static importFromFile(fileContent: string): ProjectData {
    const json = JSON.parse(fileContent) as ProjectJSON;
    return ProjectSerializer.fromJSON(json);
  }

  // ── Private serialization helpers ──

  private static _serializeSprite(sprite: Sprite): SerializedSprite {
    return {
      width: sprite.width,
      height: sprite.height,
      pixels: Array.from(sprite.pixels),
    };
  }

  private static _deserializeSprite(s: SerializedSprite): Sprite {
    return new Sprite(s.width, s.height, new Uint8Array(s.pixels));
  }

  private static _serializeTilemap(tm: Tilemap): SerializedTilemap {
    return {
      width: tm.width,
      height: tm.height,
      tileSize: tm.tileSize,
      layers: tm.layers.map((l) => ({
        name: l.name,
        width: l.width,
        height: l.height,
        tiles: Array.from(l.tiles),
        visible: l.visible,
        locked: l.locked,
        opacity: l.opacity,
      })),
      collision: {
        width: tm.collision.width,
        height: tm.collision.height,
        data: Array.from(tm.collision.data),
      },
      tilePalette: tm.tilePalette.map((e) =>
        e ? { spriteIndex: e.spriteIndex, label: e.label } : null,
      ),
      entities: tm.entities.map((e) => ({
        id: e.id,
        typeId: e.typeId,
        x: e.x,
        y: e.y,
        properties: { ...e.properties },
      })),
    };
  }

  private static _deserializeTilemap(s: SerializedTilemap): Tilemap {
    const tm = new Tilemap(s.width, s.height, s.tileSize);

    // Rebuild layers
    tm.layers = s.layers.map((sl) => {
      const layer = new Layer(sl.width, sl.height, sl.name, new Uint16Array(sl.tiles));
      layer.visible = sl.visible;
      layer.locked = sl.locked;
      layer.opacity = sl.opacity;
      return layer;
    });

    // Rebuild collision
    tm.collision = new CollisionMap(
      s.collision.width,
      s.collision.height,
      new Uint8Array(s.collision.data),
    );

    // Rebuild tile palette
    tm.tilePalette = s.tilePalette.map((e) =>
      e ? { spriteIndex: e.spriteIndex, label: e.label } : null,
    );

    // Rebuild entities
    tm.entities = s.entities.map(
      (se) =>
        new Entity(
          se.typeId,
          se.x,
          se.y,
          se.properties as any,
          se.id,
        ),
    );

    return tm;
  }

  /**
   * Migrate a JSON object from an older format version to the current one.
   */
  private static _migrate(json: ProjectJSON): ProjectJSON {
    let version = json.formatVersion ?? 0;

    // Version 0 → 1: initial format migration
    if (version < 1) {
      // Ensure required fields exist
      json.meta = json.meta ?? {
        id: generateProjectId(),
        name: 'Untitled',
        author: '',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };
      json.palette = json.palette ?? [];
      json.sprites = json.sprites ?? [];
      json.entityTypes = json.entityTypes ?? [];
      json.tilemap = json.tilemap ?? {
        width: 32,
        height: 32,
        tileSize: 16,
        layers: [],
        collision: { width: 32, height: 32, data: [] },
        tilePalette: [],
        entities: [],
      };
      version = 1;
    }

    json.formatVersion = PROJECT_FORMAT_VERSION;
    return json;
  }
}
