/**
 * EntityType — defines a category of entity that can be placed on the map.
 *
 * Each type has a name, behavior class, associated sprite, and default
 * property values.
 */

export type BehaviorType =
  | 'static'
  | 'patrol'
  | 'collectible'
  | 'spawn-point'
  | 'trigger-zone'
  | 'player-start';

/** Behaviour-specific parameters. */
export interface EntityProperties {
  speed?: number;
  direction?: 'left' | 'right' | 'up' | 'down' | 'horizontal' | 'vertical';
  patrolRange?: number;
  triggerTarget?: string;
  collectibleType?: string; // 'coin' | 'gem' | 'key'
  spawnInterval?: number;   // seconds
  triggerRadius?: number;    // pixels
  triggerOnEnter?: boolean;
  triggerOnce?: boolean;
}

export interface EntityType {
  /** Unique identifier (kebab-case, e.g. "player-start") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Behaviour category */
  behaviorType: BehaviorType;
  /** Index into the project sprites array */
  spriteIndex: number;
  /** Bounding-box overlay colour (hex) */
  color: string;
  /** Short description shown in the palette */
  description: string;
  /** Default property values when a new entity of this type is created */
  defaultProperties: EntityProperties;
}

/** Built-in entity types shipped with the editor. */
export const DEFAULT_ENTITY_TYPES: EntityType[] = [
  {
    id: 'player-start',
    name: 'Player Start',
    behaviorType: 'player-start',
    spriteIndex: 0,
    color: '#3fb950',
    description: 'Player spawn point — one per level',
    defaultProperties: { direction: 'right' },
  },
  {
    id: 'enemy-patrol',
    name: 'Enemy (Patrol)',
    behaviorType: 'patrol',
    spriteIndex: 0,
    color: '#f85149',
    description: 'Moves back and forth along an axis',
    defaultProperties: { speed: 1, direction: 'horizontal', patrolRange: 3 },
  },
  {
    id: 'collectible-coin',
    name: 'Collectible Coin',
    behaviorType: 'collectible',
    spriteIndex: 0,
    color: '#d29922',
    description: 'Picked up when the player touches it',
    defaultProperties: { collectibleType: 'coin' },
  },
  {
    id: 'collectible-gem',
    name: 'Collectible Gem',
    behaviorType: 'collectible',
    spriteIndex: 0,
    color: '#7c7cf8',
    description: 'Special collectible (gem variant)',
    defaultProperties: { collectibleType: 'gem' },
  },
  {
    id: 'trigger-zone',
    name: 'Trigger Zone',
    behaviorType: 'trigger-zone',
    spriteIndex: 0,
    color: '#58a6ff',
    description: 'Triggers an action when the player enters',
    defaultProperties: { triggerRadius: 32, triggerOnEnter: true, triggerOnce: true },
  },
  {
    id: 'spawn-point',
    name: 'Spawn Point',
    behaviorType: 'spawn-point',
    spriteIndex: 0,
    color: '#f0883e',
    description: 'Enemy/item spawner with interval',
    defaultProperties: { spawnInterval: 5 },
  },
  {
    id: 'static-npc',
    name: 'Static NPC',
    behaviorType: 'static',
    spriteIndex: 0,
    color: '#8b949e',
    description: 'Non-interactive character that stands still',
    defaultProperties: {},
  },
];
