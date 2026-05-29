/**
 * Palette — an ordered list of hex colour strings managed as the project-wide palette.
 *
 * Index 0 is reserved as transparent and is never stored in the palette list.
 * The palette always has 1-based indexing: palette[0] corresponds to colour index 1.
 */

export class Palette {
  /** Colour strings in "#RRGGBB" format. Index 0 in this array = colour index 1 in the sprite. */
  private _colours: string[];

  constructor(colours?: string[]) {
    this._colours = colours ? [...colours] : [];
  }

  /** Get the colour at the given palette index (1-based). Returns undefined if out of range. */
  getColour(index: number): string | undefined {
    return this._colours[index - 1];
  }

  /** Set the colour at the given palette index (1-based). Silently ignores out-of-range. */
  setColour(index: number, hex: string): void {
    if (index >= 1 && index <= this._colours.length) {
      this._colours[index - 1] = hex;
    }
  }

  /** Add a colour to the end of the palette. Returns its 1-based index. */
  addColour(hex: string): number {
    this._colours.push(hex);
    return this._colours.length;
  }

  /** Insert a colour at a specific 1-based position. */
  insertColour(hex: string, index: number): void {
    this._colours.splice(Math.max(0, index - 1), 0, hex);
  }

  /** Remove a colour by its 1-based index. Returns the removed colour or undefined. */
  removeColour(index: number): string | undefined {
    if (index < 1 || index > this._colours.length) return undefined;
    return this._colours.splice(index - 1, 1)[0];
  }

  /** Move a colour from one 1-based index to another (reorder). */
  moveColour(fromIndex: number, toIndex: number): void {
    if (fromIndex < 1 || fromIndex > this._colours.length) return;
    if (toIndex < 1 || toIndex > this._colours.length) return;
    const [colour] = this._colours.splice(fromIndex - 1, 1);
    this._colours.splice(toIndex - 1, 0, colour);
  }

  /** Get all colours as a copy. Indices in this array correspond to colour index + 1. */
  get colours(): string[] {
    return [...this._colours];
  }

  /** Number of colours in the palette. */
  get length(): number {
    return this._colours.length;
  }

  /** Create a deep clone. */
  clone(): Palette {
    return new Palette(this._colours);
  }

  /** Load colours from a plain array. */
  load(colours: string[]): void {
    this._colours = [...colours];
  }

  /** Serialize to a plain array for persistence. */
  toJSON(): string[] {
    return [...this._colours];
  }
}
