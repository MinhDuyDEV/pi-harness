/**
 * BehaviorGenerator — creates custom behavior scripts from natural language.
 *
 * The LLM generates JavaScript code snippets that follow a simple behavior
 * API pattern for the game runtime.
 */

import { AIClient } from './AIClient';

export interface BehaviorGenResult {
  code: string;
  description: string;
  /** Suggested entity type name */
  name: string;
}

export class BehaviorGenerator {
  /**
   * Generate a custom behavior script from a description.
   */
  static async generate(
    prompt: string,
    abortSignal?: AbortSignal,
  ): Promise<BehaviorGenResult> {
    const systemPrompt = `You are a game behavior designer. You write small JavaScript behavior scripts for game entities.
Behaviors follow this pattern:

\`\`\`
function update(entity, state, dt) {
  // entity has: x, y, properties (speed, direction, etc.)
  // state has: playerX, playerY, score, entities[]
  // dt = delta time in seconds
  // Mutate entity.x, entity.y to move
}
\`\`\`

Return JSON with:
{
  "name": "Behavior name",
  "description": "What this behavior does",
  "code": "JavaScript function body"
}

The code should be safe, self-contained, and not use any external libraries.
Use plain JavaScript compatible with modern browsers.`;

    const userPrompt = `Create a custom entity behavior that: ${prompt}

The behavior function will receive (entity, state, dt).
- entity.x, entity.y: position (pixels)
- entity.properties: custom config object
- state.playerX, state.playerY: player position
- state.score: current score
- state.entities: array of all entities
- dt: delta time in seconds

Return only the JSON. Keep the code concise and well-commented.`;

    const content = await AIClient.generate(systemPrompt, userPrompt, abortSignal);
    const result = JSON.parse(content) as BehaviorGenResult;

    if (!result.code || !result.name) {
      throw new Error('Invalid response: missing code or name');
    }

    return result;
  }
}
