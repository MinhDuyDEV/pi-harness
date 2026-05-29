/**
 * ColorPicker — a clickable swatch grid that sets the active colour index.
 */

import React from 'react';

interface ColorPickerProps {
  colours: string[];
  activeIndex: number; // 1-based palette index; 0 = transparent
  onSelect: (index: number) => void;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  colours,
  activeIndex,
  onSelect,
}) => {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Colour palette">
      {/* Transparent (eraser) swatch */}
      <button
        className={`color-swatch ${activeIndex === 0 ? 'active' : ''}`}
        onClick={() => onSelect(0)}
        title="Transparent / Eraser"
        aria-label="Transparent"
        aria-checked={activeIndex === 0}
        role="radio"
        style={{
          background: 'repeating-conic-gradient(#30363d 0% 25%, #0d1117 0% 50%) 50% / 8px 8px',
        }}
      />

      {/* Colour swatches */}
      {colours.map((hex, i) => {
        const idx = i + 1; // 1-based
        return (
          <button
            key={idx}
            className={`color-swatch ${activeIndex === idx ? 'active' : ''}`}
            onClick={() => onSelect(idx)}
            title={`${hex} (index ${idx})`}
            aria-label={`Colour ${idx}: ${hex}`}
            aria-checked={activeIndex === idx}
            role="radio"
            style={{ backgroundColor: hex }}
          />
        );
      })}
    </div>
  );
};
