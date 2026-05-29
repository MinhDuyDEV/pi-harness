/**
 * InputManager — tracks keyboard state for game input.
 *
 * Supports arrow keys + WASD for movement, Space for jump/action.
 */

export class InputManager {
  private keys: Set<string> = new Set();
  private justPressedKeys: Set<string> = new Set();
  private attached: boolean = false;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (!this.keys.has(e.code)) {
      this.justPressedKeys.add(e.code);
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  /** Attach event listeners. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /** Detach event listeners. */
  detach(): void {
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.keys.clear();
    this.justPressedKeys.clear();
  }

  /** Is a key currently held down? */
  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Was a key just pressed this frame? Call once per frame after processing. */
  wasJustPressed(code: string): boolean {
    return this.justPressedKeys.has(code);
  }

  /** Clear the just-pressed set (call at end of each frame). */
  clearFrame(): void {
    this.justPressedKeys.clear();
  }

  // Convenience accessors

  get left(): boolean {
    return this.isDown('ArrowLeft') || this.isDown('KeyA');
  }

  get right(): boolean {
    return this.isDown('ArrowRight') || this.isDown('KeyD');
  }

  get up(): boolean {
    return this.isDown('ArrowUp') || this.isDown('KeyW');
  }

  get down(): boolean {
    return this.isDown('ArrowDown') || this.isDown('KeyS');
  }

  get jump(): boolean {
    return this.wasJustPressed('Space');
  }
}
