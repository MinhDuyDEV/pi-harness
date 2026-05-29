/**
 * History — snapshot-based undo/redo for sprite editing.
 *
 * Stores compressed snapshots (Uint8Array) of sprite pixel data.
 * Default capacity is 100 steps (configurable).
 */

import { Sprite } from './Sprite';

export class History {
  private snapshots: Uint8Array[];
  private _index: number;
  private _capacity: number;

  /** Width and height must be stable across all snapshots in this history. */
  private width: number;
  private height: number;

  constructor(initialSprite: Sprite, capacity: number = 100) {
    this.snapshots = [new Uint8Array(initialSprite.pixels)];
    this._index = 0;
    this._capacity = Math.max(1, capacity);
    this.width = initialSprite.width;
    this.height = initialSprite.height;
  }

  /** Push a new snapshot. Trims future history if we're mid-undo. */
  push(sprite: Sprite): void {
    // Discard any redo states beyond current index
    this.snapshots.length = this._index + 1;

    this.snapshots.push(new Uint8Array(sprite.pixels));

    // Trim oldest if over capacity
    if (this.snapshots.length > this._capacity) {
      this.snapshots.shift();
    }

    this._index = this.snapshots.length - 1;
  }

  /** Undo one step. Returns the restored sprite or null if at oldest. */
  undo(): Sprite | null {
    if (this._index <= 0) return null;
    this._index--;
    return this._buildSprite();
  }

  /** Redo one step. Returns the restored sprite or null if at newest. */
  redo(): Sprite | null {
    if (this._index >= this.snapshots.length - 1) return null;
    this._index++;
    return this._buildSprite();
  }

  /** Can we undo? */
  get canUndo(): boolean {
    return this._index > 0;
  }

  /** Can we redo? */
  get canRedo(): boolean {
    return this._index < this.snapshots.length - 1;
  }

  /** Number of stored snapshots. */
  get size(): number {
    return this.snapshots.length;
  }

  /** Current position in the history stack (0-based). */
  get index(): number {
    return this._index;
  }

  /** Reset the history with a new starting sprite. */
  reset(sprite: Sprite): void {
    this.snapshots = [new Uint8Array(sprite.pixels)];
    this._index = 0;
    this.width = sprite.width;
    this.height = sprite.height;
  }

  /** Rebuild a sprite from the snapshot at the current index. */
  private _buildSprite(): Sprite {
    return new Sprite(this.width, this.height, this.snapshots[this._index]);
  }
}
