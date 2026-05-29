/**
 * EntityPalette — shows available entity types and lets the user pick one
 * to place on the tilemap.
 */

import React, { useCallback } from 'react';
import { EntityType } from '../core/EntityType';
import { Sprite } from '../core/Sprite';

interface EntityPaletteProps {
  entityTypes: EntityType[];
  projectSprites: Sprite[];
  activeEntityTypeId: string | null;
  onSelectEntityType: (typeId: string | null) => void;
  paletteColours: string[];
}

export const EntityPalette: React.FC<EntityPaletteProps> = ({
  entityTypes,
  projectSprites,
  activeEntityTypeId,
  onSelectEntityType,
  paletteColours,
}) => {
  const renderSpritePreview = useCallback(
    (spriteIndex: number, size: number): string => {
      const sprite = projectSprites[spriteIndex];
      if (!sprite) return '';

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;

      const scale = Math.min(size / sprite.width, size / sprite.height);
      const w = Math.round(sprite.width * scale);
      const h = Math.round(sprite.height * scale);
      const ox = Math.round((size - w) / 2);
      const oy = Math.round((size - h) / 2);

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = sprite.width;
      srcCanvas.height = sprite.height;
      const srcCtx = srcCanvas.getContext('2d')!;
      srcCtx.putImageData(sprite.toImageData(paletteColours), 0, 0);
      ctx.drawImage(srcCanvas, ox, oy, w, h);
      return canvas.toDataURL();
    },
    [projectSprites, paletteColours],
  );

  return (
    <div className="entity-palette">
      <div className="entity-palette-header">Entities</div>

      <div className="entity-palette-grid" role="listbox" aria-label="Entity types">
        {entityTypes.map((type) => {
          const dataUrl = renderSpritePreview(type.spriteIndex, 24);
          return (
            <button
              key={type.id}
              className={`entity-palette-item ${activeEntityTypeId === type.id ? 'active' : ''}`}
              onClick={() =>
                onSelectEntityType(activeEntityTypeId === type.id ? null : type.id)
              }
              role="option"
              aria-selected={activeEntityTypeId === type.id}
              title={`${type.name} — ${type.description}`}
            >
              <div
                className="entity-palette-preview"
                style={{ borderColor: type.color }}
              >
                {dataUrl ? (
                  <img src={dataUrl} alt={type.name} />
                ) : (
                  <span className="entity-palette-placeholder">?</span>
                )}
              </div>
              <span className="entity-palette-name">{type.name}</span>
              <span
                className="entity-palette-behavior-badge"
                style={{ backgroundColor: type.color + '33', color: type.color }}
              >
                {type.behaviorType}
              </span>
            </button>
          );
        })}
      </div>

      {activeEntityTypeId && (
        <div className="entity-palette-hint">
          Click on the map to place a <strong>{entityTypes.find((t) => t.id === activeEntityTypeId)?.name}</strong>
        </div>
      )}
    </div>
  );
};
