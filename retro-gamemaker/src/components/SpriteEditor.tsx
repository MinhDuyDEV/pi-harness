/**
 * SpriteEditor — pixel-level sprite editing canvas with tool integration.
 *
 * Renders a zoomable pixel grid, handles mouse input for the active tool,
 * and provides undo/redo, dimension controls, and AI generation (stubbed).
 *
 * Drawing updates are pushed to the canvas in real time via a renderTick
 * counter and a mutable spriteRef that bypasses React stale closures.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Sprite } from '../core/Sprite';
import { Palette } from '../core/Palette';
import { History } from '../core/History';
import { PaintTool } from '../tools/PaintTool';
import { FillTool } from '../tools/FillTool';
import { EyedropperTool } from '../tools/EyedropperTool';
import { ColorPicker } from './ColorPicker';

export type EditorToolId = 'pencil' | 'eraser' | 'fill' | 'picker';

export type SpriteSize = 8 | 16 | 32 | 64;

interface SpriteEditorProps {
  sprite: Sprite;
  palette: Palette;
  activeToolId: EditorToolId;
  onSpriteChange: (sprite: Sprite) => void;
  onActiveColourChange: (index: number) => void;
  activeColourIndex: number;
}

const SPRITE_SIZES: SpriteSize[] = [8, 16, 32, 64];

export const SpriteEditor: React.FC<SpriteEditorProps> = ({
  sprite,
  palette,
  activeToolId,
  onSpriteChange,
  onActiveColourChange,
  activeColourIndex,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Mutable sprite reference to avoid stale closures during drawing.
  // Initialised every time the prop changes (except during active drawing).
  const spriteRef = useRef<Sprite>(sprite);
  spriteRef.current = sprite;

  // Editor zoom (independent of main camera)
  const [editorZoom, setEditorZoom] = useState(8);

  // History
  const historyRef = useRef<History>(new History(sprite, 100));
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Drawing state
  const isDrawing = useRef(false);
  const paintTool = useRef(new PaintTool('draw'));

  // Render tick — incremented during strokes to force canvas re-render
  const [renderTick, setRenderTick] = useState(0);

  // Resize sprite
  const handleResize = useCallback((newSize: SpriteSize) => {
    const resized = sprite.resize(newSize, newSize);
    historyRef.current.reset(resized);
    spriteRef.current = resized;
    onSpriteChange(resized);
    setCanUndo(false);
    setCanRedo(false);
  }, [sprite, onSpriteChange]);

  // Undo / Redo
  const handleUndo = useCallback(() => {
    const restored = historyRef.current.undo();
    if (restored) {
      spriteRef.current = restored;
      onSpriteChange(restored);
      setCanUndo(historyRef.current.canUndo);
      setCanRedo(historyRef.current.canRedo);
    }
  }, [onSpriteChange]);

  const handleRedo = useCallback(() => {
    const restored = historyRef.current.redo();
    if (restored) {
      spriteRef.current = restored;
      onSpriteChange(restored);
      setCanUndo(historyRef.current.canUndo);
      setCanRedo(historyRef.current.canRedo);
    }
  }, [onSpriteChange]);

  // Push current sprite state to history (called before a modification)
  const pushSnapshot = useCallback(() => {
    const current = spriteRef.current;
    historyRef.current.push(current.clone());
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // ---- Pixel coordinate helpers ----

  const getPixelCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const current = spriteRef.current;
      const px = Math.floor(mx / editorZoom);
      const py = Math.floor(my / editorZoom);
      if (px < 0 || px >= current.width || py < 0 || py >= current.height) return null;
      return { x: px, y: py };
    },
    [editorZoom],
  );

  // ---- Mouse handlers ----

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const coords = getPixelCoords(e.clientX, e.clientY);
      if (!coords) return;
      e.preventDefault();

      const { x, y } = coords;
      const current = spriteRef.current;
      const colourIdx = activeColourIndex;

      switch (activeToolId) {
        case 'pencil': {
          pushSnapshot();
          paintTool.current.mode = 'draw';
          paintTool.current.start(current, x, y, colourIdx);
          isDrawing.current = true;
          setRenderTick((t) => t + 1);
          break;
        }
        case 'eraser': {
          pushSnapshot();
          paintTool.current.mode = 'erase';
          paintTool.current.start(current, x, y, colourIdx);
          isDrawing.current = true;
          setRenderTick((t) => t + 1);
          break;
        }
        case 'fill': {
          pushSnapshot();
          const fillTool = new FillTool();
          fillTool.execute(current, x, y, colourIdx);
          onSpriteChange(current.clone());
          break;
        }
        case 'picker': {
          const eyedropper = new EyedropperTool();
          const result = eyedropper.sample(current, x, y, palette.colours);
          if (result) {
            onActiveColourChange(result.colourIndex);
          }
          break;
        }
      }
    },
    [activeToolId, activeColourIndex, palette, getPixelCoords, pushSnapshot, onSpriteChange, onActiveColourChange],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing.current) return;
      const coords = getPixelCoords(e.clientX, e.clientY);
      if (!coords) return;

      const { x, y } = coords;
      const current = spriteRef.current;
      const colourIdx = activeColourIndex;

      if (activeToolId === 'pencil' || activeToolId === 'eraser') {
        paintTool.current.move(current, x, y, colourIdx);
        setRenderTick((t) => t + 1);
      }
    },
    [activeToolId, activeColourIndex, getPixelCoords],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (isDrawing.current) {
        isDrawing.current = false;
        paintTool.current.end();
        // Push final state — triggers parent re-render with new sprite identity
        onSpriteChange(spriteRef.current.clone());
      }
    },
    [onSpriteChange],
  );

  const handleMouseLeave = useCallback(() => {
    if (isDrawing.current) {
      isDrawing.current = false;
      paintTool.current.end();
      onSpriteChange(spriteRef.current.clone());
    }
  }, [onSpriteChange]);

  // ---- Render sprite to canvas ----

  const doRender = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const current = spriteRef.current;
    const zoom = editorZoom;
    const w = current.width * zoom;
    const h = current.height * zoom;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Background checkerboard for transparency
    drawCheckerboard(ctx, w, h, zoom);

    // Draw sprite pixels
    const imageData = current.toImageData(palette.colours);

    // Create an off-screen canvas at 1× for scaling
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = current.width;
    srcCanvas.height = current.height;
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.putImageData(imageData, 0, 0);

    ctx.drawImage(srcCanvas, 0, 0, w, h);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= current.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * zoom, 0);
      ctx.lineTo(x * zoom, h);
      ctx.stroke();
    }
    for (let y = 0; y <= current.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * zoom);
      ctx.lineTo(w, y * zoom);
      ctx.stroke();
    }

    // Major grid lines (every 8 pixels, thicker)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    for (let x = 8; x <= current.width; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x * zoom, 0);
      ctx.lineTo(x * zoom, h);
      ctx.stroke();
    }
    for (let y = 8; y <= current.height; y += 8) {
      ctx.beginPath();
      ctx.moveTo(0, y * zoom);
      ctx.lineTo(w, y * zoom);
      ctx.stroke();
    }
  }, [palette, editorZoom]);

  // Trigger render on sprite change, palette change, zoom change, or draw tick
  useEffect(() => {
    doRender();
  }, [doRender, renderTick]);

  // ---- Generate sprite (stubbed AI) ----

  const [isGenerating, setIsGenerating] = useState(false);
  const [promptText, setPromptText] = useState('');

  const handleGenerate = useCallback(() => {
    if (!promptText.trim()) return;
    setIsGenerating(true);

    setTimeout(() => {
      const current = spriteRef.current;
      const newSprite = new Sprite(current.width, current.height);
      const cols = palette.colours;

      // Stubbed AI generation — geometric pattern as placeholder
      for (let y = 0; y < newSprite.height; y++) {
        for (let x = 0; x < newSprite.width; x++) {
          const colourIdx = ((x + y) % Math.max(1, cols.length)) + 1;
          if (Math.random() > 0.3) {
            newSprite.setPixel(x, y, colourIdx);
          }
        }
      }

      historyRef.current.reset(newSprite);
      spriteRef.current = newSprite;
      onSpriteChange(newSprite);
      setCanUndo(false);
      setCanRedo(false);
      setIsGenerating(false);
    }, 300);
  }, [promptText, palette, onSpriteChange]);

  return (
    <div className="sprite-editor" ref={editorRef}>
      {/* Toolbar: zoom, undo/redo, size, AI generate */}
      <div className="sprite-editor-toolbar">
        <div className="editor-toolbar-group">
          <button
            className="editor-btn"
            onClick={() => setEditorZoom((z) => Math.max(1, z / 2))}
            title="Zoom out"
            disabled={editorZoom <= 1}
          >
            −
          </button>
          <span className="editor-zoom-label">{editorZoom}×</span>
          <button
            className="editor-btn"
            onClick={() => setEditorZoom((z) => Math.min(32, z * 2))}
            title="Zoom in"
            disabled={editorZoom >= 32}
          >
            +
          </button>
        </div>

        <span className="editor-size-label">
          {sprite.width}×{sprite.height}
        </span>

        <select
          className="editor-select"
          value={sprite.width}
          onChange={(e) => handleResize(Number(e.target.value) as SpriteSize)}
          title="Sprite size"
        >
          {SPRITE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}×{s}
            </option>
          ))}
        </select>

        <div className="editor-toolbar-group">
          <button
            className="editor-btn"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            className="editor-btn"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            ↷
          </button>
        </div>

        <div className="editor-toolbar-spacer" />

        {/* AI generate */}
        <input
          className="editor-input"
          type="text"
          placeholder="Describe a sprite..."
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleGenerate();
          }}
        />
        <button
          className="editor-btn editor-btn-primary"
          onClick={handleGenerate}
          disabled={isGenerating || !promptText.trim()}
          title="Generate Sprite (AI, stubbed)"
        >
          {isGenerating ? '…' : '✨ Generate'}
        </button>
      </div>

      {/* Pixel canvas */}
      <div className="sprite-editor-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="sprite-editor-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{
            cursor: activeToolId === 'fill' ? 'crosshair' : 'default',
          }}
        />
      </div>

      {/* Colour picker below canvas */}
      <ColorPicker
        colours={palette.colours}
        activeIndex={activeColourIndex}
        onSelect={onActiveColourChange}
      />
    </div>
  );
};

/* ─── Helpers ─── */

function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, cellSize: number,
): void {
  const c1 = '#1c2128';
  const c2 = '#0d1117';
  ctx.fillStyle = c2;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = c1;
  for (let y = 0; y < h; y += cellSize) {
    for (let x = 0; x < w; x += cellSize) {
      const cellX = Math.floor(x / cellSize);
      const cellY = Math.floor(y / cellSize);
      if ((cellX + cellY) % 2 === 0) {
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }
  }
}
