/**
 * Project — top-level container for all editor data.
 *
 * Holds project metadata, palette, sprites, and the full tilemap.
 * Used as the serialization unit for save/load and export/import.
 */

/** Current serialization format version. Increment on breaking changes. */
export const PROJECT_FORMAT_VERSION = 1;

/** Project metadata displayed in the project picker. */
export interface ProjectMeta {
  id: string;
  name: string;
  author: string;
  createdAt: string;  // ISO-8601
  modifiedAt: string; // ISO-8601
  formatVersion: number;
  thumbnail?: string; // data URL of a small preview
}

/** Serializable sprite data (flat array of palette indices). */
export interface SerializedSprite {
  width: number;
  height: number;
  pixels: number[]; // Uint8Array → number[] for JSON
}

/** Serializable layer data. */
export interface SerializedLayer {
  name: string;
  width: number;
  height: number;
  tiles: number[]; // Uint16Array → number[]
  visible: boolean;
  locked: boolean;
  opacity: number;
}

/** Serializable collision map. */
export interface SerializedCollision {
  width: number;
  height: number;
  data: number[]; // Uint8Array → number[]
}

/** Serializable tile palette entry. */
export interface SerializedTilePaletteEntry {
  spriteIndex: number;
  label?: string;
}

/** Serializable entity. */
export interface SerializedEntity {
  id: string;
  typeId: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
}

/** Serializable tilemap. */
export interface SerializedTilemap {
  width: number;
  height: number;
  tileSize: number;
  layers: SerializedLayer[];
  collision: SerializedCollision;
  tilePalette: (SerializedTilePaletteEntry | null)[];
  entities: SerializedEntity[];
}

/** The full project JSON structure. */
export interface ProjectJSON {
  formatVersion: number;
  meta: {
    id: string;
    name: string;
    author: string;
    createdAt: string;
    modifiedAt: string;
  };
  palette: string[];
  sprites: SerializedSprite[];
  entityTypes: Array<{
    id: string;
    name: string;
    behaviorType: string;
    spriteIndex: number;
    color: string;
    description: string;
    defaultProperties: Record<string, unknown>;
  }>;
  tilemap: SerializedTilemap;
}

/**
 * Generate a short unique id for projects.
 */
let _projectIdCounter = 0;
export function generateProjectId(): string {
  return `proj_${Date.now().toString(36)}_${(_projectIdCounter++).toString(36)}`;
}
