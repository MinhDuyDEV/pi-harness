/**
 * CollectibleBehavior — configuration for items the player can pick up.
 */

import { EntityProperties } from '../EntityType';

export type CollectibleVariant = 'coin' | 'gem' | 'key';

/** The visual / scoring variant. */
export function getCollectibleType(props: EntityProperties): CollectibleVariant {
  const t = props.collectibleType;
  if (t === 'gem' || t === 'key') return t;
  return 'coin';
}

/** Score value associated with each variant. */
export function collectibleScore(variant: CollectibleVariant): number {
  switch (variant) {
    case 'coin': return 100;
    case 'gem':  return 500;
    case 'key':  return 0; // special item, no score
  }
}
