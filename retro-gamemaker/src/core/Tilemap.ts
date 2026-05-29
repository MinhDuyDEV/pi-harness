/**
 * Tilemap — the full tile-based level data model.
 *
 * Holds the layer stack, the collision map, and the tile palette (mapping
 * tile indices to project sprites). The tile palette index 0 is reserved
 * as empty/no-tile.
 */

import { Layer } from './Layer';
import { CollisionMap } from './CollisionMap';
import { Entity, MAX_ENTITIES } from './Entity';

/** Maps a tile palette index (1-based) to a project sprite. */
export interface TilePaletteEntry {
  /** Index into the project's sprite array */
  spriteIndex: number;
  /** Optional display label */
  label?: string;
}

export const DEFAULT_TILE_SIZE = 16;

export class Tilemap {
  /** Map dimensions in tiles */
  width: number;
  height: number;
  /** Pixel size of each tile */
  tileSize: number;
  /** Ordered layer stack (index 0 = bottom) */
  layers: Layer[];
  /** Collision grid (same dimensions as the map) */
  collision: CollisionMap;
  /** Tile palette: index 0 is always empty; entries are 1-based. */
  tilePalette: (TilePaletteEntry | null)[];
  /** Placed entity instances. */
  entities: Entity[];

  constructor(
    width: number = 32,
    height: number = 32,
    tileSize: number = DEFAULT_TILE_SIZE,
  ) {
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.layers = [
      new Layer(width, height, 'Background'),
      new Layer(width, height, 'Foreground'),
    ];
    this.collision = new CollisionMap(width, height);
    // Index 0 is null (empty), so actual entries start at index 1
    this.tilePalette = [null];
    this.entities = [];
  }

  /** Total pixel width of the map. */
  get pixelWidth(): number {
    return this.width * this.tileSize;
  }

  /** Total pixel height of the map. */
  get pixelHeight(): number {
    return this.height * this.tileSize;
  }

  /** Number of non-null tile palette entries. */
  get paletteSize(): number {
    return this.tilePalette.length - 1;
  }

  /** Add a tile to the palette. Returns its 1-based index. */
  addTileToPalette(entry: TilePaletteEntry): number {
    this.tilePalette.push(entry);
    return this.tilePalette.length - 1;
  }

  /** Set a tile palette entry at a given 1-based index. */
  setTilePalette(index: number, entry: TilePaletteEntry | null): void {
    if (index > 0 && index < this.tilePalette.length) {
      this.tilePalette[index] = entry;
    }
  }

  /** Remove a tile palette entry at a given 1-based index.
   *  All existing tile references >= index are shifted down. */
  removeTileFromPalette(index: number): void {
    if (index <= 0 || index >= this.tilePalette.length) return;
    this.tilePalette.splice(index, 1);
    // Shift down tile references in all layers
    for (const layer of this.layers) {
      for (let i = 0; i < layer.tiles.length; i++) {
        if (layer.tiles[i] > index) {
          layer.tiles[i]--;
        } else if (layer.tiles[i] === index) {
          layer.tiles[i] = 0; // removed tile becomes empty
        }
      }
    }
  }

  /** Add a new layer at the top of the stack. Returns the layer. */
  addLayer(name?: string): Layer {
    const idx = this.layers.length;
    const layer = new Layer(this.width, this.height, name ?? `Layer ${idx + 1}`);
    this.layers.push(layer);
    return layer;
  }

  /** Remove a layer by index. */
  removeLayer(index: number): Layer | undefined {
    if (index < 0 || index >= this.layers.length) return undefined;
    return this.layers.splice(index, 1)[0];
  }

  /** Move a layer from one index to another (reorder). */
  moveLayer(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.layers.length) return;
    if (toIndex < 0 || toIndex >= this.layers.length) return;
    const [layer] = this.layers.splice(fromIndex, 1);
    this.layers.splice(toIndex, 0, layer);
  }

  /** Resize the entire tilemap (all layers + collision). Content preserved at (0,0). */
  resize(newWidth: number, newHeight: number): void {
    this.width = newWidth;
    this.height = newHeight;
    this.layers = this.layers.map((l) => l.resize(newWidth, newHeight));
    this.collision = this.collision.resize(newWidth, newHeight);
    // Keep entities within bounds
    const maxPxX = this.pixelWidth;
    const maxPxY = this.pixelHeight;
    for (const e of this.entities) {
      e.x = Math.min(e.x, maxPxX);
      e.y = Math.min(e.y, maxPxY);
    }
  }

  /** Create a deep clone of the entire tilemap. */
  clone(): Tilemap {
    const t = new Tilemap(this.width, this.height, this.tileSize);
    t.layers = this.layers.map((l) => l.clone());
    t.collision = this.collision.clone();
    t.tilePalette = this.tilePalette.map((e) => (e ? { ...e } : null));
    t.entities = this.entities.map((e) => e.clone());
    return t;
  }

  /** Remove all tiles from all layers (keeps structure). */
  clearAllLayers(): void {
    for (const layer of this.layers) {
      layer.tiles.fill(0);
    }
    this.collision.data.fill(0);
  }

  /** Check if adding another entity would exceed the limit. */
  get canAddEntity(): boolean {
    return this.entities.length < MAX_ENTITIES;
  }

  /** Add an entity, respecting the max limit. Returns true if added. */
  addEntity(entity: Entity): boolean {
    if (this.entities.length >= MAX_ENTITIES) return false;
    this.entities.push(entity);
    return true;
  }

  /** Remove an entity by id. Returns true if found and removed. */
  removeEntity(entityId: string): boolean {
    const idx = this.entities.findIndex((e) => e.id === entityId);
    if (idx === -1) return false;
    this.entities.splice(idx, 1);
    return true;
  }

  /** Find an entity by id. */
  getEntity(entityId: string): Entity | undefined {
    return this.entities.find((e) => e.id === entityId);
  }
}
