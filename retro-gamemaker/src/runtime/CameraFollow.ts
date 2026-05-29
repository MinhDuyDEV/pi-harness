/**
 * CameraFollow — smooth camera that follows a target (player) with lerp.
 */

export class CameraFollow {
  x: number = 0;
  y: number = 0;
  zoom: number = 2;
  /** Lerp factor (0–1); higher = tighter follow */
  smoothness: number = 4;

  viewportWidth: number = 0;
  viewportHeight: number = 0;

  setViewport(w: number, h: number): void {
    this.viewportWidth = w;
    this.viewportHeight = h;
  }

  /**
   * Update the camera position, lerping toward the target.
   */
  update(targetX: number, targetY: number, dt: number): void {
    const lerpFactor = 1 - Math.exp(-this.smoothness * dt);
    this.x += (targetX - this.x) * lerpFactor;
    this.y += (targetY - this.y) * lerpFactor;
  }

  /** Snap directly to a position (for restart). */
  snapTo(targetX: number, targetY: number): void {
    this.x = targetX;
    this.y = targetY;
  }

  /**
   * Apply the camera transform to a 2D canvas context.
   * Centers the target in the viewport.
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.viewportWidth / 2, this.viewportHeight / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
}
