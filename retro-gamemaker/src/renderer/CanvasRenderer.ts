/**
 * CanvasRenderer — owns the <canvas> element and runs the render loop.
 *
 * Draws a grid overlay in world space, delegates camera transform to Camera,
 * and runs at 60fps via requestAnimationFrame.
 */

import { Camera } from './Camera';

/** Grid line colour (low-contrast so it doesn't dominate) */
const GRID_LINE_COLOR = 'rgba(255, 255, 255, 0.06)';
const GRID_LINE_COLOR_MAJOR = 'rgba(255, 255, 255, 0.10)';

/** Subdivisions per major grid line */
const MAJOR_SUBDIVISIONS = 4;

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly camera: Camera;

  private animFrameId: number | null = null;
  private running: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = new Camera();

    this._attachEvents();
  }

  // ---- Lifecycle ----

  /** Start the render loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  /** Stop the render loop. */
  stop(): void {
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /** Resize the canvas to match its CSS display size. Call on window resize. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    this.camera.viewportWidth = w;
    this.camera.viewportHeight = h;
  }

  /** Returns the canvas display size in CSS pixels. */
  getSize(): { width: number; height: number } {
    return {
      width: this.camera.viewportWidth,
      height: this.camera.viewportHeight,
    };
  }

  // ---- Render loop ----

  private _loop = (): void => {
    if (!this.running) return;
    this.resize();
    this._render();
    this.animFrameId = requestAnimationFrame(this._loop);
  };

  private _render(): void {
    const ctx = this.ctx;
    const w = this.camera.viewportWidth;
    const h = this.camera.viewportHeight;

    // Clear
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);

    // --- World content (transformed) ---
    ctx.save();
    this.camera.applyTransform(ctx);

    this._drawGrid(ctx);

    ctx.restore();

    // --- Screen-space overlay: crosshair at centre ---
    this._drawCrosshair(ctx, w, h);
  }

  // ---- Grid ----

  private _drawGrid(ctx: CanvasRenderingContext2D): void {
    const spacing = this.camera.gridSpacing;
    const majorSpacing = spacing * MAJOR_SUBDIVISIONS;

    // Compute visible world bounds (with generous padding)
    const cam = this.camera;
    const margin = 2;
    const left = cam.x - (cam.viewportWidth / 2) / cam.zoom - spacing * margin;
    const right = cam.x + (cam.viewportWidth / 2) / cam.zoom + spacing * margin;
    const top = cam.y - (cam.viewportHeight / 2) / cam.zoom - spacing * margin;
    const bottom = cam.y + (cam.viewportHeight / 2) / cam.zoom + spacing * margin;

    // Compute first and last grid lines
    const startX = Math.floor(left / spacing) * spacing;
    const startY = Math.floor(top / spacing) * spacing;
    const endX = right;
    const endY = bottom;

    ctx.strokeStyle = GRID_LINE_COLOR;
    ctx.lineWidth = 1 / cam.zoom;

    // Minor grid lines
    for (let x = startX; x <= endX; x += spacing) {
      if (x % majorSpacing === 0) continue; // skip majors, drawn separately
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    for (let y = startY; y <= endY; y += spacing) {
      if (y % majorSpacing === 0) continue;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    // Major grid lines (brighter)
    ctx.strokeStyle = GRID_LINE_COLOR_MAJOR;
    const majorStartX = Math.floor(left / majorSpacing) * majorSpacing;
    const majorStartY = Math.floor(top / majorSpacing) * majorSpacing;

    for (let x = majorStartX; x <= endX; x += majorSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    for (let y = majorStartY; y <= endY; y += majorSpacing) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
  }

  // ---- Crosshair ----

  private _drawCrosshair(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(w / 2 - 12, h / 2);
    ctx.lineTo(w / 2 + 12, h / 2);
    ctx.moveTo(w / 2, h / 2 - 12);
    ctx.lineTo(w / 2, h / 2 + 12);
    ctx.stroke();
  }

  // ---- Event binding ----

  private _attachEvents(): void {
    const canvas = this.canvas;
    canvas.addEventListener('mousedown', (e) => this.camera.handleMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this.camera.handleMouseMove(e));
    canvas.addEventListener('mouseup', (e) => this.camera.handleMouseUp(e));
    canvas.addEventListener('mouseleave', () => {
      // End pan if mouse leaves the canvas while dragging
      if (this.camera.isPanning) {
        this.camera['_isPanning'] = false;
      }
    });
    canvas.addEventListener('wheel', (e) => this.camera.handleWheel(e), { passive: false });

    // Prevent default context menu on middle-click
    canvas.addEventListener('contextmenu', (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }
}
