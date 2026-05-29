/**
 * ExportEngine — coordinates the game export pipeline.
 *
 * Takes project data → packs sprites → generates runtime → wraps in HTML.
 */

import { Sprite } from '../core/Sprite';
import { Palette } from '../core/Palette';
import { Tilemap } from '../core/Tilemap';
import { Entity } from '../core/Entity';
import { EntityType } from '../core/EntityType';
import { SpritePacker } from './SpritePacker';
import { RuntimeBundle } from './RuntimeBundle';
import { HTMLTemplate } from './HTMLTemplate';

export interface ExportResult {
  html: string;
  sizeBytes: number;
  packedDataSize: number;
  spriteCount: number;
  tileCount: number;
  entityCount: number;
}

export interface OptimizationSuggestion {
  type: 'info' | 'warning' | 'success';
  message: string;
}

export class ExportEngine {
  /**
   * Generate the complete exported HTML file content.
   */
  static export(
    projectName: string,
    sprites: Sprite[],
    palette: Palette,
    tilemap: Tilemap,
    entities: Entity[],
    entityTypes: EntityType[],
  ): ExportResult {
    // Pack data
    const packed = SpritePacker.pack(
      sprites,
      palette.colours,
      tilemap,
      entities,
      entityTypes,
    );

    // Compact JSON (no extra whitespace)
    const gameDataJson = JSON.stringify(packed);

    // Generate runtime
    const runtimeJs = RuntimeBundle.generate();

    // Generate HTML
    const html = HTMLTemplate.generate(projectName, gameDataJson, runtimeJs);

    const htmlBytes = new Blob([html]).size;

    return {
      html,
      sizeBytes: htmlBytes,
      packedDataSize: new Blob([gameDataJson]).size,
      spriteCount: sprites.length,
      tileCount: tilemap.width * tilemap.height,
      entityCount: entities.length,
    };
  }

  /**
   * Analyze the project and return optimization suggestions (mock AI).
   */
  static analyze(
    sprites: Sprite[],
    tilemap: Tilemap,
    entities: Entity[],
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    const totalTiles = tilemap.width * tilemap.height;

    // Check sprite sizes
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      if (s.width > 32 || s.height > 32) {
        suggestions.push({
          type: 'warning',
          message: `Sprite ${i + 1} is ${s.width}×${s.height}. Consider using 16×16 or 32×32 for better performance.`,
        });
      }
    }

    // Check palette size
    if (sprites.length > 0) {
      suggestions.push({
        type: 'info',
        message: `${sprites.length} sprites exported (${sprites.reduce((a, s) => a + s.width * s.height, 0)} total pixels).`,
      });
    }

    // Check map size
    if (totalTiles > 65536) {
      suggestions.push({
        type: 'warning',
        message: `Map is ${tilemap.width}×${tilemap.height} (${totalTiles} tiles). Consider reducing to under 256×256 for faster load.`,
      });
    } else if (totalTiles > 16384) {
      suggestions.push({
        type: 'info',
        message: `Map is ${tilemap.width}×${tilemap.height} (${totalTiles} tiles). Performance should be good.`,
      });
    } else {
      suggestions.push({
        type: 'success',
        message: `Map size (${tilemap.width}×${tilemap.height}) is well within optimal range.`,
      });
    }

    // Check entity count
    if (entities.length > 100) {
      suggestions.push({
        type: 'warning',
        message: `${entities.length} entities may impact performance. Consider using fewer than 100 for smooth gameplay.`,
      });
    } else {
      suggestions.push({
        type: 'success',
        message: `${entities.length} entities — well within performance limits.`,
      });
    }

    // Check empty layers
    const emptyLayers = tilemap.layers.filter(
      (l) => l.tiles.every((t) => t === 0),
    ).length;
    if (emptyLayers > 0 && tilemap.layers.length > 2) {
      suggestions.push({
        type: 'info',
        message: `${emptyLayers} layer(s) are empty. Consider removing them to reduce file size.`,
      });
    }

    // Estimate file size
    suggestions.push({
      type: 'info',
      message: `Estimated export size: < 500KB for typical projects.`,
    });

    return suggestions;
  }

  /**
   * Download the exported HTML file.
   */
  static download(html: string, projectName: string): void {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
