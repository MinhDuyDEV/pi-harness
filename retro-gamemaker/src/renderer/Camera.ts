/**
 * Camera — manages pan (x, y) and zoom for the canvas viewport.
 *
 * Provides transform helpers and mouse-event handlers for pan (middle-click drag)
 * and zoom (scroll wheel) with 60fps rendering via requestAnimationFrame.
 */

export interface CameraOptions {
  /** Initial X offset in world pixels */
  x?: number;
  /** Initial Y offset in world pixels */
  y?: number;
  /** Initial zoom level (1 = 100%) */
  zoom?: number;
  /** Minimum zoom level */
  minZoom?: number;
  /** Maximum zoom level */
  maxZoom?: number;
  /** Grid base spacing in world units */
  gridSpacing?: number;
}

export class Camera {
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  gridSpacing: number;

  /** Viewport dimensions in CSS pixels */
  viewportWidth: number = 0;
  viewportHeight: number = 0;

  private _isPanning: boolean = false;

  /** Whether the camera is currently being panned by the user. */
  get isPanning(): boolean { return this._isPanning; }
  private _panStartX: number = 0;
  private _panStartY: number = 0;
  private _panCameraX: number = 0;
  private _panCameraY: number = 0;

  constructor(opts: CameraOptions = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.zoom = opts.zoom ?? 1;
    this.minZoom = opts.minZoom ?? 0.1;
    this.maxZoom = opts.maxZoom ?? 32;
    this.gridSpacing = opts.gridSpacing ?? 16;
  }

  // ---- Coordinate transforms ----

  /** Convert screen (CSS pixel) coordinates to world coordinates. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewportWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewportHeight / 2) / this.zoom + this.y,
    };
  }

  /** Convert world coordinates to screen (CSS pixel) coordinates. */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.viewportWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewportHeight / 2,
    };
  }

  /** Centre the camera on a world coordinate. */
  lookAt(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
  }

  // ---- Canvas context helpers ----

  /** Apply the camera transform to a 2D canvas context. Call before drawing world content. */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.viewportWidth / 2, this.viewportHeight / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  // ---- Mouse interaction ----

  /** Handle mousedown for middle-button pan initiation. */
  handleMouseDown(e: MouseEvent): void {
    if (e.button === 1) {
      this._isPanning = true;
      this._panStartX = e.clientX;
      this._panStartY = e.clientY;
      this._panCameraX = this.x;
      this._panCameraY = this.y;
      e.preventDefault();
    }
  }

  /** Handle mousemove for pan drag. */
  handleMouseMove(e: MouseEvent): void {
    if (this._isPanning) {
      const dx = e.clientX - this._panStartX;
      const dy = e.clientY - this._panStartY;
      this.x = this._panCameraX - dx / this.zoom;
      this.y = this._panCameraY - dy / this.zoom;
    }
  }

  /** Handle mouseup to end pan. */
  handleMouseUp(e: MouseEvent): void {
    if (e.button === 1) {
      this._isPanning = false;
    }
  }

  /** Handle wheel for zoom, centred on the mouse position. */
  handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * zoomFactor));

    if (newZoom === this.zoom) return;

    // Zoom towards the mouse position
    const mouse = this.screenToWorld(e.clientX, e.clientY);
    this.zoom = newZoom;
    this.x = mouse.x - (e.clientX - this.viewportWidth / 2) / this.zoom;
    this.y = mouse.y - (e.clientY - this.viewportHeight / 2) / this.zoom;
  }
}
