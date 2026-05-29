/**
 * PalettePresets — predefined colour palettes inspired by retro hardware.
 *
 * Each preset is a named array of "#RRGGBB" hex strings.
 * Index 0 is always transparent (not included here).
 */

export interface PalettePreset {
  name: string;
  description: string;
  colours: string[];
}

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    name: 'NES',
    description: 'Nintendo Entertainment System — 52 colours',
    colours: [
      '#7c7c7c', '#0000fc', '#0000bc', '#4428bc',
      '#940088', '#a80020', '#a81000', '#881400',
      '#503000', '#007800', '#006800', '#005800',
      '#004058', '#000000', '#000000', '#000000',
      '#bcbcbc', '#0078f8', '#0058f8', '#6844fc',
      '#d800cc', '#e40058', '#f83800', '#e45c10',
      '#ac7c00', '#00b800', '#00a800', '#00a844',
      '#008888', '#000000', '#000000', '#000000',
      '#f8f8f8', '#3cbcfc', '#6888fc', '#9878f8',
      '#f878f8', '#f85898', '#f87858', '#fca044',
      '#f8b800', '#b8f818', '#58d858', '#58f89c',
      '#00e8d8', '#787878', '#000000', '#000000',
      '#fcfcfc', '#a4e4fc', '#b8b8f8', '#d8b8f8',
      '#f8b8f8', '#f8a4c0', '#f0d0b0', '#fce0a8',
      '#f8d878', '#d8f878', '#b8f8b8', '#b8f8d8',
      '#00fcfc', '#f8d8f8', '#000000', '#000000',
    ],
  },
  {
    name: 'Game Boy',
    description: 'Nintendo Game Boy — 4 shades of olive-green',
    colours: [
      '#e6f5da', '#8bac0f', '#4a6f08', '#223005',
    ],
  },
  {
    name: 'CGA',
    description: 'IBM CGA (Mode 4, Palette 1) — 4 colours',
    colours: [
      '#000000', '#00aa00', '#aa0000', '#aaaa00',
    ],
  },
  {
    name: 'PICO-8',
    description: 'PICO-8 fantasy console — 16 colours',
    colours: [
      '#000000', '#1d2b53', '#7e2553', '#008751',
      '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#fff024', '#00e756',
      '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ],
  },
  {
    name: 'Mono',
    description: 'Black & white — 2 colours',
    colours: [
      '#ffffff', '#000000',
    ],
  },
  {
    name: 'Custom',
    description: 'Start with a clean slate',
    colours: [
      '#ff0000', '#00ff00', '#0000ff', '#ffff00',
      '#ff00ff', '#00ffff', '#ffffff', '#888888',
    ],
  },
];

/** Apply a preset to get a fresh copy of its colours. */
export function getPresetColours(presetName: string): string[] | undefined {
  const preset = PALETTE_PRESETS.find((p) => p.name === presetName);
  return preset ? [...preset.colours] : undefined;
}
