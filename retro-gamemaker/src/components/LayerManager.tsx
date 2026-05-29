/**
 * LayerManager — layer stack controls: visibility, lock, reorder, opacity, rename.
 */

import React, { useCallback } from 'react';
import { Layer } from '../core/Layer';

interface LayerManagerProps {
  layers: Layer[];
  activeLayerIndex: number;
  onActiveLayerChange: (index: number) => void;
  onLayersChange: (layers: Layer[]) => void;
}

export const LayerManager: React.FC<LayerManagerProps> = ({
  layers,
  activeLayerIndex,
  onActiveLayerChange,
  onLayersChange,
}) => {
  const handleToggleVisibility = useCallback(
    (index: number) => {
      const updated = layers.map((l, i) => {
        if (i === index) {
          l.visible = !l.visible;
        }
        return l;
      });
      // Clone to trigger React re-render
      onLayersChange(updated.map((l) => l.clone()));
    },
    [layers, onLayersChange],
  );

  const handleToggleLock = useCallback(
    (index: number) => {
      const updated = layers.map((l, i) => {
        if (i === index) l.locked = !l.locked;
        return l;
      });
      onLayersChange(updated.map((l) => l.clone()));
    },
    [layers, onLayersChange],
  );

  const handleOpacityChange = useCallback(
    (index: number, opacity: number) => {
      const updated = layers.map((l, i) => {
        if (i === index) l.opacity = opacity;
        return l;
      });
      onLayersChange(updated.map((l) => l.clone()));
    },
    [layers, onLayersChange],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      const updated = [...layers];
      [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
      onLayersChange(updated.map((l) => l.clone()));
      onActiveLayerChange(
        activeLayerIndex === index ? index - 1 : activeLayerIndex,
      );
    },
    [layers, activeLayerIndex, onLayersChange, onActiveLayerChange],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= layers.length - 1) return;
      const updated = [...layers];
      [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
      onLayersChange(updated.map((l) => l.clone()));
      onActiveLayerChange(
        activeLayerIndex === index ? index + 1 : activeLayerIndex,
      );
    },
    [layers, activeLayerIndex, onLayersChange, onActiveLayerChange],
  );

  const handleRename = useCallback(
    (index: number, name: string) => {
      const updated = layers.map((l, i) => {
        if (i === index) l.name = name;
        return l;
      });
      onLayersChange(updated.map((l) => l.clone()));
    },
    [layers, onLayersChange],
  );

  return (
    <div className="layer-manager">
      <div className="layer-manager-header">Layers</div>

      <div className="layer-list" role="list" aria-label="Tile layers">
        {[...layers].reverse().map((layer, ri) => {
          const idx = layers.length - 1 - ri; // reverse index for display (top layer first)
          return (
            <div
              key={idx}
              className={`layer-item ${idx === activeLayerIndex ? 'active' : ''}`}
              role="listitem"
              onClick={() => onActiveLayerChange(idx)}
            >
              {/* Visibility toggle */}
              <button
                className="layer-btn-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleVisibility(idx);
                }}
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                aria-label={`Toggle visibility for ${layer.name}`}
              >
                {layer.visible ? '👁' : '—'}
              </button>

              {/* Lock toggle */}
              <button
                className="layer-btn-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleLock(idx);
                }}
                title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                aria-label={`Toggle lock for ${layer.name}`}
              >
                {layer.locked ? '🔒' : '🔓'}
              </button>

              {/* Name */}
              <input
                className="layer-name-input"
                value={layer.name}
                onChange={(e) => handleRename(idx, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Layer name for ${layer.name}`}
              />

              {/* Opacity */}
              <input
                type="range"
                className="layer-opacity-slider"
                min={0}
                max={1}
                step={0.05}
                value={layer.opacity}
                onChange={(e) => {
                  e.stopPropagation();
                  handleOpacityChange(idx, parseFloat(e.target.value));
                }}
                onClick={(e) => e.stopPropagation()}
                title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
                aria-label={`Opacity for ${layer.name}`}
              />

              <span className="layer-opacity-label">
                {Math.round(layer.opacity * 100)}%
              </span>

              {/* Reorder */}
              <button
                className="layer-btn-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMoveUp(idx);
                }}
                disabled={idx <= 0}
                title="Move layer up"
                aria-label="Move layer up"
              >
                ↑
              </button>
              <button
                className="layer-btn-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMoveDown(idx);
                }}
                disabled={idx >= layers.length - 1}
                title="Move layer down"
                aria-label="Move layer down"
              >
                ↓
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
