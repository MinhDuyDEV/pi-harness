/**
 * TilePalette — assign project sprites to tile slots and select the active tile.
 */

import React, { useCallback } from 'react';
import { TilePaletteEntry } from '../core/Tilemap';
import { Sprite } from '../core/Sprite';

interface TilePaletteProps {
  tilePalette: (TilePaletteEntry | null)[];
  projectSprites: Sprite[];
  activeTileIndex: number;
  onActiveTileChange: (index: number) => void;
  onTilePaletteChange: (palette: (TilePaletteEntry | null)[]) => void;
  paletteColours: string[];
}

export const TilePalette: React.FC<TilePaletteProps> = ({
  tilePalette,
  projectSprites,
  activeTileIndex,
  onActiveTileChange,
  onTilePaletteChange,
  paletteColours,
}) => {
  const handleAssignSprite = useCallback(
    (tileIndex: number, spriteIndex: number) => {
      const updated = [...tilePalette];
      updated[tileIndex] = { spriteIndex, label: `Tile ${tileIndex}` };
      onTilePaletteChange(updated);
    },
    [tilePalette, onTilePaletteChange],
  );

  const handleRemoveTile = useCallback(
    (tileIndex: number) => {
      const updated = [...tilePalette];
      updated[tileIndex] = null;
      onTilePaletteChange(updated);
      if (activeTileIndex === tileIndex) {
        // Find next valid tile
        const next = updated.findIndex((e, i) => i > 0 && e !== null);
        onActiveTileChange(next > 0 ? next : 0);
      }
    },
    [tilePalette, activeTileIndex, onTilePaletteChange, onActiveTileChange],
  );

  const handleAddTile = useCallback(() => {
    const updated = [...tilePalette];
    const spriteIdx = 0; // default to first sprite
    updated.push({ spriteIndex: spriteIdx, label: `Tile ${updated.length}` });
    onTilePaletteChange(updated);
  }, [tilePalette, onTilePaletteChange]);

  // Render a sprite preview onto a small canvas
  const renderSpritePreview = (sprite: Sprite, size: number): string => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Scale sprite to fit the preview tile
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
  };

  return (
    <div className="tile-palette">
      <div className="tile-palette-header">
        <span>Tile Palette</span>
        <button
          className="palette-btn-sm"
          onClick={handleAddTile}
          title="Add new tile slot"
        >
          + Add Tile
        </button>
      </div>

      <div className="tile-palette-grid" role="listbox" aria-label="Tile palette">
        {/* Empty slot for eraser */}
        <div
          className={`tile-palette-item ${activeTileIndex === 0 ? 'active' : ''}`}
          onClick={() => onActiveTileChange(0)}
          role="option"
          aria-selected={activeTileIndex === 0}
          title="Empty / Eraser"
        >
          <div className="tile-palette-preview empty-tile">
            <span className="tile-empty-label">✕</span>
          </div>
          <span className="tile-palette-label">Empty</span>
        </div>

        {/* Tile entries */}
        {tilePalette.map((entry, idx) => {
          if (idx === 0) return null; // skip reserved index 0
          if (!entry) return null;

          const sprite = projectSprites[entry.spriteIndex];
          if (!sprite) return null;

          const dataUrl = renderSpritePreview(sprite, 32);

          return (
            <div
              key={idx}
              className={`tile-palette-item ${activeTileIndex === idx ? 'active' : ''}`}
              onClick={() => onActiveTileChange(idx)}
              role="option"
              aria-selected={activeTileIndex === idx}
              title={entry.label ?? `Tile ${idx}`}
            >
              <div className="tile-palette-preview">
                <img src={dataUrl} alt={entry.label ?? `Tile ${idx}`} />
              </div>
              <span className="tile-palette-label">
                {entry.label ?? `#${idx}`}
              </span>
              <button
                className="tile-palette-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveTile(idx);
                }}
                title="Remove tile from palette"
                aria-label={`Remove tile ${idx}`}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* Sprite assignment */}
      {activeTileIndex > 0 && tilePalette[activeTileIndex] && (
        <div className="tile-palette-assign">
          <span className="tile-assign-label">Assign sprite:</span>
          <select
            className="editor-select"
            value={tilePalette[activeTileIndex]!.spriteIndex}
            onChange={(e) =>
              handleAssignSprite(activeTileIndex, Number(e.target.value))
            }
          >
            {projectSprites.map((_, i) => (
              <option key={i} value={i}>
                Sprite {i + 1}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
