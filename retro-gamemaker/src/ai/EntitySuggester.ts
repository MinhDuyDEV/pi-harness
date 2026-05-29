/**
 * EntitySuggester — analyses the current level layout and suggests
 * entity placements for gameplay balance.
 */

import { AIClient } from './AIClient';

export interface EntitySuggestion {
  typeId: string;
  name: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
  reason: string;
}

export interface EntitySuggesterResult {
  entities: EntitySuggestion[];
  overview: string;
}

export class EntitySuggester {
  /**
   * Suggest entity placements for the current level.
   * @param prompt     User's description/request
   * @param mapWidth   Map width in tiles
   * @param mapHeight  Map height in tiles
   * @param tileSize   Pixel size of each tile
   * @param tileLabels Descriptions of available tiles (for context)
   * @param availableEntityTypes  Entity types the user has defined
   * @param existingEntitySummary  Count/description of existing entities
   * @param abortSignal Optional cancellation
   */
  static async suggest(
    prompt: string,
    mapWidth: number,
    mapHeight: number,
    tileSize: number,
    tileLabels: string[],
    availableEntityTypes: Array<{ id: string; name: string }>,
    existingEntitySummary: string,
    abortSignal?: AbortSignal,
  ): Promise<EntitySuggesterResult> {
    const typeDesc = availableEntityTypes
      .map((t) => `  - ${t.id}: ${t.name}`)
      .join('\n');

    const systemPrompt = `You are a game designer specialising in level layout and gameplay balance.
You analyse tilemaps and suggest entity placements (enemies, collectibles, triggers, player start).

Return JSON with this structure:
{
  "entities": [
    {
      "typeId": "entity-type-id",
      "name": "Entity name",
      "x": pixel_x,
      "y": pixel_y,
      "properties": {},
      "reason": "Why placed here"
    }
  ],
  "overview": "Brief explanation of the entity layout strategy"
}

Place entities at pixel coordinates (not tile coordinates).
x = col * tileSize + tileSize/2, y = row * tileSize + tileSize/2.
The map is ${mapWidth}×${mapHeight} tiles at ${tileSize}px each.`;

    const userPrompt = `Map: ${mapWidth}×${mapHeight} tiles (${mapWidth * tileSize}×${mapHeight * tileSize}px)
Tile labels: ${tileLabels.join(', ') || 'none'}
Available entity types:
${typeDesc}
Existing entities: ${existingEntitySummary}

Suggest entity placements for: ${prompt}

Place entities thoughtfully:
- Player start near the beginning (left side)
- Enemies patrol at ground level with gaps between them
- Collectibles along the path or in slightly tricky spots
- Keep all entities within map bounds`;

    const content = await AIClient.generate(systemPrompt, userPrompt, abortSignal);
    const result = JSON.parse(content) as EntitySuggesterResult;

    if (!Array.isArray(result.entities)) {
      throw new Error('Invalid response format: missing entities array');
    }

    return result;
  }
}
