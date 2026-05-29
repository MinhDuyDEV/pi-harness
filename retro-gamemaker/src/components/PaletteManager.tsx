/**
 * PaletteManager — full palette editing UI with presets, add, remove, reorder.
 */

import React, { useState, useCallback } from 'react';
import { Palette } from '../core/Palette';
import { PALETTE_PRESETS, PalettePreset } from '../core/PalettePresets';

interface PaletteManagerProps {
  palette: Palette;
  activeColourIndex: number;
  onSelectColour: (index: number) => void;
  onPaletteChange: (palette: Palette) => void;
}

export const PaletteManager: React.FC<PaletteManagerProps> = ({
  palette,
  activeColourIndex,
  onSelectColour,
  onPaletteChange,
}) => {
  const colours = palette.colours;
  const [showPresets, setShowPresets] = useState(false);
  const [newColour, setNewColour] = useState('#ff0000');

  const handleAddColour = useCallback(() => {
    const p = palette.clone();
    p.addColour(newColour);
    onPaletteChange(p);
  }, [palette, newColour, onPaletteChange]);

  const handleRemoveColour = useCallback((index: number) => {
    if (palette.length <= 1) return; // keep at least one colour
    const p = palette.clone();
    p.removeColour(index);
    onPaletteChange(p);
  }, [palette, onPaletteChange]);

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 1) return;
    const p = palette.clone();
    p.moveColour(index, index - 1);
    onPaletteChange(p);
  }, [palette, onPaletteChange]);

  const handleMoveDown = useCallback((index: number) => {
    if (index >= palette.length) return;
    const p = palette.clone();
    p.moveColour(index, index + 1);
    onPaletteChange(p);
  }, [palette, onPaletteChange]);

  const handlePresetSelect = useCallback((preset: PalettePreset) => {
    const p = new Palette(preset.colours);
    onPaletteChange(p);
    setShowPresets(false);
  }, [onPaletteChange]);

  const handleColourChange = useCallback((index: number, hex: string) => {
    const p = palette.clone();
    p.setColour(index, hex);
    onPaletteChange(p);
  }, [palette, onPaletteChange]);

  return (
    <div className="palette-manager">
      <div className="palette-manager-header">
        <span>Palette</span>
        <button
          className="palette-btn-sm"
          onClick={() => setShowPresets(!showPresets)}
          title="Load palette preset"
        >
          {showPresets ? '✕' : '↺'}
        </button>
      </div>

      {/* Preset dropdown */}
      {showPresets && (
        <div className="palette-presets">
          {PALETTE_PRESETS.map((preset) => (
            <button
              key={preset.name}
              className="palette-preset-btn"
              onClick={() => handlePresetSelect(preset)}
              title={preset.description}
            >
              <span className="preset-name">{preset.name}</span>
              <span className="preset-colours">
                {preset.colours.map((hex, i) => (
                  <span
                    key={i}
                    className="preset-dot"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Colour swatches with controls */}
      <div className="palette-list" role="listbox" aria-label="Palette colours">
        {colours.map((hex, i) => {
          const idx = i + 1; // 1-based
          return (
            <div
              key={idx}
              className={`palette-item ${activeColourIndex === idx ? 'active' : ''}`}
              role="option"
              aria-selected={activeColourIndex === idx}
            >
              <input
                type="color"
                className="palette-colour-input"
                value={hex}
                onChange={(e) => handleColourChange(idx, e.target.value)}
                aria-label={`Colour ${idx}`}
              />
              <span
                className="palette-colour-swatch"
                style={{ backgroundColor: hex }}
                onClick={() => onSelectColour(idx)}
              />
              <span className="palette-index">#{idx}</span>
              <div className="palette-item-actions">
                <button
                  className="palette-btn-xs"
                  onClick={() => handleMoveUp(idx)}
                  disabled={idx <= 1}
                  title="Move left"
                  aria-label="Move colour left"
                >
                  ←
                </button>
                <button
                  className="palette-btn-xs"
                  onClick={() => handleMoveDown(idx)}
                  disabled={idx >= palette.length}
                  title="Move right"
                  aria-label="Move colour right"
                >
                  →
                </button>
                <button
                  className="palette-btn-xs danger"
                  onClick={() => handleRemoveColour(idx)}
                  disabled={palette.length <= 1}
                  title="Remove colour"
                  aria-label="Remove colour"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add colour */}
      <div className="palette-add">
        <input
          type="color"
          className="palette-colour-input"
          value={newColour}
          onChange={(e) => setNewColour(e.target.value)}
          aria-label="New colour"
        />
        <input
          type="text"
          className="palette-hex-input"
          value={newColour}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) setNewColour(v);
          }}
          placeholder="#FF0000"
        />
        <button className="palette-btn-sm" onClick={handleAddColour}>
          + Add
        </button>
      </div>
    </div>
  );
};
