/**
 * Behavior — base types and configuration for entity behaviors.
 *
 * Each behavior type has a human-readable label and a set of
 * configurable parameters that the EntityInspector can render.
 */

import { BehaviorType, EntityProperties } from './EntityType';

/** Describes a single configurable property for the inspector UI. */
export interface BehaviorParamDef {
  key: keyof EntityProperties;
  label: string;
  type: 'number' | 'select' | 'boolean' | 'string';
  /** Options for 'select' type */
  options?: string[];
  /** Min/max for 'number' type */
  min?: number;
  max?: number;
  step?: number;
}

/** Full definition of a behaviour for the editor UI. */
export interface BehaviorDef {
  type: BehaviorType;
  label: string;
  description: string;
  params: BehaviorParamDef[];
}

/** Built-in behavior definitions used by the inspector. */
export const BEHAVIOR_DEFS: BehaviorDef[] = [
  {
    type: 'static',
    label: 'Static',
    description: 'Stands still; no movement or interaction.',
    params: [],
  },
  {
    type: 'patrol',
    label: 'Patrol',
    description: 'Moves back and forth along an axis within a range.',
    params: [
      { key: 'speed', label: 'Speed', type: 'number', min: 0.5, max: 8, step: 0.5 },
      { key: 'direction', label: 'Direction', type: 'select', options: ['horizontal', 'vertical'] },
      { key: 'patrolRange', label: 'Range (tiles)', type: 'number', min: 1, max: 32, step: 1 },
    ],
  },
  {
    type: 'collectible',
    label: 'Collectible',
    description: 'Picked up when the player overlaps it.',
    params: [
      { key: 'collectibleType', label: 'Type', type: 'select', options: ['coin', 'gem', 'key'] },
    ],
  },
  {
    type: 'spawn-point',
    label: 'Spawn Point',
    description: 'Periodically spawns entities at this position.',
    params: [
      { key: 'spawnInterval', label: 'Interval (s)', type: 'number', min: 1, max: 60, step: 1 },
    ],
  },
  {
    type: 'trigger-zone',
    label: 'Trigger Zone',
    description: 'Fires an action when the player enters the zone.',
    params: [
      { key: 'triggerRadius', label: 'Radius (px)', type: 'number', min: 8, max: 256, step: 8 },
      { key: 'triggerOnce', label: 'Trigger once', type: 'boolean' },
    ],
  },
  {
    type: 'player-start',
    label: 'Player Start',
    description: 'Defines where the player spawns in the level.',
    params: [
      { key: 'direction', label: 'Facing', type: 'select', options: ['left', 'right'] },
    ],
  },
];

/** Look up a behavior definition by type. */
export function getBehaviorDef(type: BehaviorType): BehaviorDef | undefined {
  return BEHAVIOR_DEFS.find((b) => b.type === type);
}
