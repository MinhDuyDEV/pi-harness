/**
 * SpritePreview — renders the sprite at fixed zoom factors (1×, 2×, 4×)
 * using small off-screen canvases.
 */

import React, { useRef, useEffect } from 'react';
import { Sprite } from '../core/Sprite';

interface SpritePreviewProps {
  sprite: Sprite;
  palette: string[];
  zoomFactors?: number[];
}

export const SpritePreview: React.FC<SpritePreviewProps> = ({
  sprite,
  palette,
  zoomFactors = [1, 2, 4],
}) => {
  return (
    <div className="sprite-preview">
      <div className="sprite-preview-title">Preview</div>
      <div className="sprite-preview-grid">
        {zoomFactors.map((zoom) => (
          <PreviewCanvas
            key={zoom}
            sprite={sprite}
            palette={palette}
            zoom={zoom}
            label={`${zoom}×`}
          />
        ))}
      </div>
    </div>
  );
};

/* ─── Internal preview canvas ─── */

interface PreviewCanvasProps {
  sprite: Sprite;
  palette: string[];
  zoom: number;
  label: string;
}

const PreviewCanvas: React.FC<PreviewCanvasProps> = ({
  sprite,
  palette,
  zoom,
  label,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const w = sprite.width * zoom;
    const h = sprite.height * zoom;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d')!;
    const imageData = sprite.toImageData(palette);

    // Create an off-screen canvas at 1× and scale it up
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = sprite.width;
    srcCanvas.height = sprite.height;
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.putImageData(imageData, 0, 0);

    // Use image smoothing for crisp nearest-neighbour scaling
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(srcCanvas, 0, 0, w, h);
  }, [sprite, palette, zoom]);

  return (
    <div className="preview-canvas-wrapper">
      <canvas ref={canvasRef} className="preview-canvas" />
      <span className="preview-label">{label}</span>
    </div>
  );
};
