/**
 * TiledImporter — imports Tiled .tmx (XML) format maps into the
 * internal Tilemap representation.
 *
 * Supports: tile layers (CSV or base64 encoded), basic tile size detection.
 * Does not support: object layers, image layers, tileset management
 * (tilesets must be manually assigned after import).
 */

import { Tilemap } from '../core/Tilemap';
import { Layer } from '../core/Layer';

export interface TiledImportResult {
  tilemap: Tilemap;
  /** Number of distinct tile IDs found (for palette sizing) */
  tileIdCount: number;
  warnings: string[];
}

export class TiledImporter {
  /**
   * Parse a .tmx file (XML string) and convert to an internal Tilemap.
   */
  static parse(tmxContent: string): TiledImportResult {
    const warnings: string[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(tmxContent, 'text/xml');

    const mapEl = doc.querySelector('map');
    if (!mapEl) throw new Error('Invalid .tmx file: missing <map> element');

    // Map attributes
    const mapWidth = parseInt(mapEl.getAttribute('width') ?? '0', 10);
    const mapHeight = parseInt(mapEl.getAttribute('height') ?? '0', 10);
    const tileWidth = parseInt(mapEl.getAttribute('tilewidth') ?? '16', 10);
    const tileHeight = parseInt(mapEl.getAttribute('tileheight') ?? '16', 10);

    if (!mapWidth || !mapHeight) {
      throw new Error('Invalid map dimensions in .tmx file');
    }

    if (tileWidth !== tileHeight) {
      warnings.push(`Non-square tiles (${tileWidth}×${tileHeight}) will be treated as ${Math.min(tileWidth, tileHeight)}px.`);
    }

    const ts = Math.min(tileWidth, tileHeight);
    const tilemap = new Tilemap(mapWidth, mapHeight, ts);

    // Parse layers
    const layerEls = doc.querySelectorAll('layer');
    const allTileIds = new Set<number>();

    tilemap.layers = [];
    for (const layerEl of layerEls) {
      const name = layerEl.getAttribute('name') ?? 'Imported Layer';
      const dataEl = layerEl.querySelector('data');

      if (!dataEl) {
        warnings.push(`Layer "${name}" has no data, skipping.`);
        continue;
      }

      const encoding = dataEl.getAttribute('encoding') ?? 'csv';
      let tiles: number[];

      if (encoding === 'csv') {
        tiles = TiledImporter._parseCSV(dataEl.textContent ?? '', mapWidth, mapHeight, warnings);
      } else if (encoding === 'base64') {
        tiles = TiledImporter._parseBase64(dataEl.textContent ?? '', mapWidth, mapHeight, dataEl.getAttribute('compression'));
      } else {
        warnings.push(`Unsupported encoding "${encoding}" in layer "${name}".`);
        continue;
      }

      const layer = new Layer(mapWidth, mapHeight, name, new Uint16Array(tiles));
      tilemap.layers.push(layer);

      // Track unique tile IDs
      for (const id of tiles) {
        if (id > 0) allTileIds.add(id);
      }
    }

    // Build a tile palette from the unique tile IDs
    // Tiled uses 0 = empty, 1+ = tile IDs. We map these to palette entries.
    tilemap.tilePalette = [null]; // index 0 = empty
    // Create placeholder palette entries for each unique tile ID
    const maxTileId = Math.max(...allTileIds, 0);
    for (let i = 1; i <= maxTileId; i++) {
      if (allTileIds.has(i)) {
        tilemap.tilePalette.push({ spriteIndex: 0, label: `Tiled Tile ${i}` });
      } else {
        tilemap.tilePalette.push(null);
      }
    }

    // Remap tile indices: Tiled uses 1-based IDs that may not be contiguous
    // We keep them as-is since they match our tilePalette indices

    if (tilemap.layers.length === 0) {
      warnings.push('No tile layers found in the .tmx file.');
      // Add an empty layer
      tilemap.layers.push(new Layer(mapWidth, mapHeight, 'Layer 1'));
    }

    return {
      tilemap,
      tileIdCount: allTileIds.size,
      warnings,
    };
  }

  private static _parseCSV(
    text: string,
    expectedW: number,
    expectedH: number,
    warnings: string[],
  ): number[] {
    const values = text
      .replace(/\s/g, '')
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n));

    if (values.length !== expectedW * expectedH) {
      warnings.push(`CSV data length (${values.length}) does not match map dimensions (${expectedW}×${expectedH}).`);
    }

    return values;
  }

  private static _parseBase64(
    text: string,
    expectedW: number,
    expectedH: number,
    compression: string | null,
  ): number[] {
    if (compression && compression !== 'zlib') {
      throw new Error(`Unsupported base64 compression: ${compression}. Only zlib (or uncompressed) is supported.`);
    }

    // Remove whitespace
    const clean = text.replace(/\s/g, '');
    const binaryStr = atob(clean);

    // For uncompressed base64, each tile ID is 4 bytes (Uint32)
    const expectedLen = expectedW * expectedH;
    const tiles: number[] = [];

    if (compression === 'zlib') {
      throw new Error('zlib compression is not supported in browser. Use CSV or uncompressed base64 export from Tiled.');
    }

    // Uncompressed: each 4 bytes = one uint32 tile ID
    for (let i = 0; i < binaryStr.length && tiles.length < expectedLen; i += 4) {
      const id =
        (binaryStr.charCodeAt(i) | 
         (binaryStr.charCodeAt(i + 1) << 8) |
         (binaryStr.charCodeAt(i + 2) << 16) |
         (binaryStr.charCodeAt(i + 3) << 24)) >>> 0;
      tiles.push(id);
    }

    return tiles;
  }
}
