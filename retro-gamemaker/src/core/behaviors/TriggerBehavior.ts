/**
 * TriggerBehavior — configuration for zones that fire actions on player entry.
 */

import { EntityProperties } from '../EntityType';

/** Get the trigger radius in pixels. */
export function getTriggerRadius(props: EntityProperties): number {
  return props.triggerRadius ?? 32;
}

/** Whether the trigger should fire only once. */
export function isTriggerOnce(props: EntityProperties): boolean {
  return props.triggerOnce ?? true;
}

/** Whether the trigger fires on enter (vs. continuous while inside). */
export function isTriggerOnEnter(props: EntityProperties): boolean {
  return props.triggerOnEnter ?? true;
}
