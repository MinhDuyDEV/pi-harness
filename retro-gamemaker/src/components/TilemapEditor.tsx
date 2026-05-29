/**
 * TilemapEditor — canvas-based tile map editor with camera pan/zoom,
 * layer compositing, collision overlay, entity rendering/placement,
 * and auto-scroll.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Tilemap } from '../core/Tilemap';
import { Sprite } from '../core/Sprite';
import { EntityType } from '../core/EntityType';
import { Entity } from '../core/Entity';
import { Camera } from '../renderer/Camera';
import { TilePaintTool } from '../tools/TilePaintTool';
import { TileEraseTool } from '../tools/TileEraseTool';
import { EntityPlaceTool } from '../tools/EntityPlaceTool';

export type TileEditorTool = 'paint' | 'erase' | 'collision' | 'entity';

interface TilemapEditorProps {
  tilemap: Tilemap;
  projectSprites: Sprite[];
  paletteColours: string[];
  activeTool: TileEditorTool;
  activeTileIndex: number;
  activeLayerIndex: number;
  entityTypes: EntityType[];
  activeEntityTypeId: string | null;
  selectedEntityId: string | null;
  onTilemapChange: (tilemap: Tilemap) => void;
  onEntitySelect?: (entityId: string | null) => void;
}

const AUTO_SCROLL_MARGIN = 40;
const AUTO_SCROLL_SPEED = 0.5;
const ENTITY_SNAP_RADIUS = 24;

export const TilemapEditor: React.FC<TilemapEditorProps> = ({
  tilemap,
  projectSprites,
  paletteColours,
  activeTool,
  activeTileIndex,
  activeLayerIndex,
  entityTypes,
  activeEntityTypeId,
  selectedEntityId,
  onTilemapChange,
  onEntitySelect,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>(new Camera({ zoom: 2, minZoom: 0.25, maxZoom: 8 }));
  const paintToolRef = useRef(new TilePaintTool());
  const eraseToolRef = useRef(new TileEraseTool());
  const entityToolRef = useRef(new EntityPlaceTool());

  const tilemapRef = useRef(tilemap);
  tilemapRef.current = tilemap;

  const [renderTick, setRenderTick] = useState(0);
  const isDrawing = useRef(false);
  const autoScrollInterval = useRef<number | null>(null);
  const isDraggingEntity = useRef(false);
  const dragEntityStart = useRef<{ x: number; y: number } | null>(null);

  // Map size controls (UI state, not data)
  const [mapWidth, setMapWidth] = useState(tilemap.width);
  const [mapHeight, setMapHeight] = useState(tilemap.height);
  const [showCollision, setShowCollision] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');

  useEffect(() => {
    setMapWidth(tilemap.width);
    setMapHeight(tilemap.height);
  }, [tilemap.width, tilemap.height]);

  // ---- Camera mouse handlers ----

  const getWorldCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return camera.screenToWorld(clientX - rect.left, clientY - rect.top);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (e.button === 1) {
      camera.handleMouseDown(e.nativeEvent);
      return;
    }

    if (e.button !== 0) return;

    const world = getWorldCoords(e.clientX, e.clientY);
    if (!world) return;
    const tm = tilemapRef.current;

    // Entity tool
    if (activeTool === 'entity') {
      const activeType = activeEntityTypeId
        ? entityTypes.find((t) => t.id === activeEntityTypeId)
        : null;

      if (activeType) {
        // Place new entity
        const result = entityToolRef.current.place(tm, activeType, world.x, world.y);
        if (result) {
          onTilemapChange(result.tilemap);
          onEntitySelect?.(result.entity.id);
        }
      } else {
        // Try to select an existing entity
        const clicked = entityToolRef.current.findAt(tm, world.x, world.y, ENTITY_SNAP_RADIUS);
        if (clicked) {
          onEntitySelect?.(clicked.id);
          isDraggingEntity.current = true;
          dragEntityStart.current = { x: world.x - clicked.x, y: world.y - clicked.y };
        } else {
          onEntitySelect?.(null);
        }
      }
      return;
    }

    // Tile tools
    const tileSize = tm.tileSize;
    const col = Math.floor(world.x / tileSize);
    const row = Math.floor(world.y / tileSize);

    if (col < 0 || col >= tm.width || row < 0 || row >= tm.height) return;

    e.preventDefault();
    isDrawing.current = true;

    switch (activeTool) {
      case 'paint': {
        const layer = tm.layers[activeLayerIndex];
        if (!layer || layer.locked) return;
        paintToolRef.current.start(layer, col, row, activeTileIndex);
        setRenderTick((t) => t + 1);
        break;
      }
      case 'erase': {
        const layer = tm.layers[activeLayerIndex];
        if (!layer || layer.locked) return;
        eraseToolRef.current.start(layer, col, row);
        setRenderTick((t) => t + 1);
        break;
      }
      case 'collision': {
        const cm = tm.collision;
        cm.setSolid(col, row, !cm.isSolid(col, row));
        setRenderTick((t) => t + 1);
        break;
      }
    }
  }, [activeTool, activeLayerIndex, activeTileIndex, activeEntityTypeId, entityTypes, getWorldCoords, onTilemapChange, onEntitySelect]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Pan
    if (camera['_isPanning']) {
      camera.handleMouseMove(e.nativeEvent);
      setRenderTick((t) => t + 1);
      return;
    }

    // Drag existing entity
    if (isDraggingEntity.current && selectedEntityId && dragEntityStart.current) {
      const world = getWorldCoords(e.clientX, e.clientY);
      if (!world) return;
      const tm = tilemapRef.current;
      const updated = entityToolRef.current.move(tm, selectedEntityId, world.x - dragEntityStart.current.x, world.y - dragEntityStart.current.y);
      if (updated) {
        onTilemapChange(updated);
      }
      return;
    }

    if (!isDrawing.current) return;

    const world = getWorldCoords(e.clientX, e.clientY);
    if (!world) return;
    const tm = tilemapRef.current;
    const col = Math.floor(world.x / tm.tileSize);
    const row = Math.floor(world.y / tm.tileSize);

    if (col < 0 || col >= tm.width || row < 0 || row >= tm.height) return;

    switch (activeTool) {
      case 'paint': {
        const layer = tm.layers[activeLayerIndex];
        if (!layer || layer.locked) return;
        paintToolRef.current.move(layer, col, row, activeTileIndex);
        setRenderTick((t) => t + 1);
        break;
      }
      case 'erase': {
        const layer = tm.layers[activeLayerIndex];
        if (!layer || layer.locked) return;
        eraseToolRef.current.move(layer, col, row);
        setRenderTick((t) => t + 1);
        break;
      }
      case 'collision': {
        tm.collision.setSolid(col, row, true);
        setRenderTick((t) => t + 1);
        break;
      }
    }
  }, [activeTool, activeLayerIndex, selectedEntityId, getWorldCoords, onTilemapChange]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) {
      cameraRef.current.handleMouseUp(e.nativeEvent);
      return;
    }

    if (e.button !== 0) return;

    if (isDraggingEntity.current) {
      isDraggingEntity.current = false;
      dragEntityStart.current = null;
      return;
    }

    if (isDrawing.current) {
      isDrawing.current = false;
      paintToolRef.current.end();
      eraseToolRef.current.end();
      onTilemapChange(tilemapRef.current.clone());
    }
  }, [onTilemapChange]);

  const handleMouseLeave = useCallback(() => {
    if (isDrawing.current) {
      isDrawing.current = false;
      paintToolRef.current.end();
      eraseToolRef.current.end();
      onTilemapChange(tilemapRef.current.clone());
    }
    isDraggingEntity.current = false;
    dragEntityStart.current = null;
    if (autoScrollInterval.current !== null) {
      cancelAnimationFrame(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  }, [onTilemapChange]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    cameraRef.current.handleWheel(e.nativeEvent);
    setRenderTick((t) => t + 1);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  }, []);

  // ---- Auto-scroll ----

  const doAutoScroll = useCallback(() => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || (!isDrawing.current && !isDraggingEntity.current)) return;

    const rect = canvas.getBoundingClientRect();
    const mx = (window as any)._pi_lastMouseX ?? rect.width / 2;
    const my = (window as any)._pi_lastMouseY ?? rect.height / 2;
    const ts = tilemapRef.current.tileSize;
    const speedPx = AUTO_SCROLL_SPEED * ts;

    if (mx < AUTO_SCROLL_MARGIN) camera.x -= speedPx / camera.zoom;
    if (mx > rect.width - AUTO_SCROLL_MARGIN) camera.x += speedPx / camera.zoom;
    if (my < AUTO_SCROLL_MARGIN) camera.y -= speedPx / camera.zoom;
    if (my > rect.height - AUTO_SCROLL_MARGIN) camera.y += speedPx / camera.zoom;

    setRenderTick((t) => t + 1);
    autoScrollInterval.current = requestAnimationFrame(doAutoScroll);
  }, []);

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    (window as any)._pi_lastMouseX = e.clientX;
    (window as any)._pi_lastMouseY = e.clientY;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleGlobalMouseMove);
    return () => window.removeEventListener('mousemove', handleGlobalMouseMove);
  }, [handleGlobalMouseMove]);

  useEffect(() => {
    if ((isDrawing.current || isDraggingEntity.current) && autoScrollInterval.current === null) {
      autoScrollInterval.current = requestAnimationFrame(doAutoScroll);
    }
    if (!isDrawing.current && !isDraggingEntity.current && autoScrollInterval.current !== null) {
      cancelAnimationFrame(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  }, [isDrawing.current, isDraggingEntity.current, doAutoScroll]);

  // ---- Canvas resize ----

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    cameraRef.current.viewportWidth = w;
    cameraRef.current.viewportHeight = h;
  }, []);

  // ---- Render ----

  const doRender = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvas();

    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const camera = cameraRef.current;
    const tm = tilemapRef.current;

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, camera.viewportWidth, camera.viewportHeight);

    // ---- World transform ----
    ctx.save();
    camera.applyTransform(ctx);

    drawTileCheckerboard(ctx, tm);

    // Draw layers bottom to top
    for (let li = 0; li < tm.layers.length; li++) {
      const layer = tm.layers[li];
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      drawLayer(ctx, layer, tm, projectSprites, paletteColours);
      ctx.globalAlpha = 1;
    }

    if (showCollision) {
      drawCollisionOverlay(ctx, tm);
    }

    // Draw entities
    drawEntities(ctx, tm, entityTypes, projectSprites, paletteColours, selectedEntityId);

    drawTileGrid(ctx, camera, tm);

    ctx.restore();
  }, [projectSprites, paletteColours, showCollision, entityTypes, selectedEntityId, resizeCanvas]);

  useEffect(() => {
    doRender();
  }, [doRender, renderTick]);

  useEffect(() => {
    const onResize = () => setRenderTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---- Map resize ----

  const handleMapResize = useCallback(() => {
    const newW = Math.max(16, Math.min(256, mapWidth));
    const newH = Math.max(16, Math.min(256, mapHeight));
    tilemapRef.current.resize(newW, newH);
    setMapWidth(newW);
    setMapHeight(newH);
    onTilemapChange(tilemapRef.current.clone());
  }, [mapWidth, mapHeight, onTilemapChange]);

  // ---- Generate Level (stubbed AI) ----

  const handleGenerateLevel = useCallback(() => {
    if (!generatePrompt.trim()) return;
    setIsGenerating(true);

    setTimeout(() => {
      const tm = tilemapRef.current;
      const hasContent = tm.layers.some((l) => {
        for (let i = 0; i < l.tiles.length; i++) {
          if (l.tiles[i] !== 0) return true;
        }
        return false;
      });

      if (!hasContent && tm.paletteSize > 0) {
        const bg = tm.layers[0];
        const paletteMax = tm.paletteSize;
        for (let y = 0; y < tm.height; y++) {
          for (let x = 0; x < tm.width; x++) {
            const tileIdx = y > tm.height * 0.6
              ? (Math.floor(Math.random() * Math.min(3, paletteMax)) + 1)
              : 0;
            bg.setTile(x, y, tileIdx);
          }
        }
        if (tm.layers.length > 1) {
          const fg = tm.layers[1];
          for (let y = 0; y < tm.height; y++) {
            for (let x = 0; x < tm.width; x++) {
              if (y < tm.height * 0.6 && Math.random() < 0.03) {
                fg.setTile(x, y, Math.floor(Math.random() * paletteMax) + 1);
              }
            }
          }
        }
      }

      onTilemapChange(tm.clone());
      setIsGenerating(false);
    }, 400);
  }, [generatePrompt, onTilemapChange]);

  // ---- Suggest Entities (stubbed AI) ----

  const handleSuggestEntities = useCallback(() => {
    if (!generatePrompt.trim()) return;
    setIsGenerating(true);

    setTimeout(() => {
      const tm = tilemapRef.current;
      const clone = tm.clone();
      const existingCount = clone.entities.length;

      if (existingCount < 10 && clone.paletteSize > 0) {
        // Place mock entities: player start at left, some enemies/collectibles
        const playerType = entityTypes.find((t) => t.id === 'player-start');
        const enemyType = entityTypes.find((t) => t.id === 'enemy-patrol');
        const coinType = entityTypes.find((t) => t.id === 'collectible-coin');

        if (playerType && clone.canAddEntity) {
          clone.addEntity(new Entity(playerType.id, 32, clone.pixelHeight - 64));
        }
        if (enemyType) {
          for (let i = 0; i < 3 && clone.canAddEntity; i++) {
            const ex = 80 + Math.random() * (clone.pixelWidth - 160);
            const ey = clone.pixelHeight - 80 - Math.random() * 64;
            clone.addEntity(new Entity(enemyType.id, ex, ey));
          }
        }
        if (coinType) {
          for (let i = 0; i < 5 && clone.canAddEntity; i++) {
            const cx = 50 + Math.random() * (clone.pixelWidth - 100);
            const cy = 50 + Math.random() * (clone.pixelHeight * 0.5);
            clone.addEntity(new Entity(coinType.id, cx, cy));
          }
        }
      }

      onTilemapChange(clone);
      setIsGenerating(false);
    }, 400);
  }, [generatePrompt, entityTypes, onTilemapChange]);

  return (
    <div className="tilemap-editor" ref={containerRef}>
      {/* Editor toolbar */}
      <div className="tilemap-editor-toolbar">
        <div className="editor-toolbar-group">
          <button
            className="editor-btn"
            onClick={() => { cameraRef.current.zoom = Math.max(0.25, cameraRef.current.zoom / 1.5); setRenderTick((t) => t + 1); }}
            title="Zoom out"
          >
            −
          </button>
          <span className="editor-zoom-label">
            {Math.round(cameraRef.current.zoom * 100)}%
          </span>
          <button
            className="editor-btn"
            onClick={() => { cameraRef.current.zoom = Math.min(8, cameraRef.current.zoom * 1.5); setRenderTick((t) => t + 1); }}
            title="Zoom in"
          >
            +
          </button>
        </div>

        <span className="editor-size-label">
          {tilemap.width}×{tilemap.height}
        </span>

        <label className="editor-field-label">
          W:
          <input className="editor-number-input" type="number" min={16} max={256} value={mapWidth} onChange={(e) => setMapWidth(Number(e.target.value))} />
        </label>
        <label className="editor-field-label">
          H:
          <input className="editor-number-input" type="number" min={16} max={256} value={mapHeight} onChange={(e) => setMapHeight(Number(e.target.value))} />
        </label>
        <button className="editor-btn" onClick={handleMapResize} title="Resize map">Resize</button>

        <div className="editor-toolbar-spacer" />

        <label className="editor-toggle-label">
          <input type="checkbox" checked={showCollision} onChange={(e) => setShowCollision(e.target.checked)} />
          Collision
        </label>

        {/* Generate / Suggest */}
        <input
          className="editor-input"
          type="text"
          placeholder="Describe a level or entities..."
          value={generatePrompt}
          onChange={(e) => setGeneratePrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateLevel(); }}
        />
        <button className="editor-btn" onClick={handleGenerateLevel} disabled={isGenerating || !generatePrompt.trim()} title="Generate level tiles">
          🏗 Gen
        </button>
        <button className="editor-btn editor-btn-primary" onClick={handleSuggestEntities} disabled={isGenerating || !generatePrompt.trim()} title="Suggest entity placement">
          {isGenerating ? '…' : '✨ Suggest'}
        </button>
      </div>

      {/* Canvas */}
      <div className="tilemap-editor-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="tilemap-editor-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
          style={{ cursor: activeTool === 'entity' ? 'crosshair' : undefined }}
        />
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   Rendering helpers
   ══════════════════════════════════════════════════════════════════ */

function drawTileCheckerboard(ctx: CanvasRenderingContext2D, tm: Tilemap): void {
  const ts = tm.tileSize;
  const pw = tm.pixelWidth;
  const ph = tm.pixelHeight;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, pw, ph);
  ctx.fillStyle = '#1c2128';
  for (let y = 0; y < ph; y += ts) {
    for (let x = 0; x < pw; x += ts) {
      if ((Math.floor(x / ts) + Math.floor(y / ts)) % 2 === 0) {
        ctx.fillRect(x, y, ts, ts);
      }
    }
  }
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: import('../core/Layer').Layer,
  tm: Tilemap,
  sprites: Sprite[],
  paletteColours: string[],
): void {
  const ts = tm.tileSize;
  for (let row = 0; row < tm.height; row++) {
    for (let col = 0; col < tm.width; col++) {
      const tileIdx = layer.getTile(col, row);
      if (tileIdx === 0) continue;
      const entry = tm.tilePalette[tileIdx];
      if (!entry) continue;
      const sprite = sprites[entry.spriteIndex];
      if (!sprite) continue;
      const src = document.createElement('canvas');
      src.width = sprite.width;
      src.height = sprite.height;
      const sctx = src.getContext('2d')!;
      sctx.putImageData(sprite.toImageData(paletteColours), 0, 0);
      ctx.drawImage(src, col * ts, row * ts, ts, ts);
    }
  }
}

function drawCollisionOverlay(ctx: CanvasRenderingContext2D, tm: Tilemap): void {
  const ts = tm.tileSize;
  ctx.fillStyle = 'rgba(255, 50, 50, 0.25)';
  for (let row = 0; row < tm.height; row++) {
    for (let col = 0; col < tm.width; col++) {
      if (tm.collision.isSolid(col, row)) {
        ctx.fillRect(col * ts, row * ts, ts, ts);
      }
    }
  }
}

function drawTileGrid(ctx: CanvasRenderingContext2D, camera: Camera, tm: Tilemap): void {
  const ts = tm.tileSize;
  const pw = tm.pixelWidth;
  const ph = tm.pixelHeight;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1 / camera.zoom;
  for (let x = 0; x <= tm.width; x++) {
    ctx.beginPath(); ctx.moveTo(x * ts, 0); ctx.lineTo(x * ts, ph); ctx.stroke();
  }
  for (let y = 0; y <= tm.height; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * ts); ctx.lineTo(pw, y * ts); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2 / camera.zoom;
  for (let x = 0; x <= tm.width; x += 8) {
    ctx.beginPath(); ctx.moveTo(x * ts, 0); ctx.lineTo(x * ts, ph); ctx.stroke();
  }
  for (let y = 0; y <= tm.height; y += 8) {
    ctx.beginPath(); ctx.moveTo(0, y * ts); ctx.lineTo(pw, y * ts); ctx.stroke();
  }
}

/** Draw all entities as sprites with bounding-box overlays. */
function drawEntities(
  ctx: CanvasRenderingContext2D,
  tm: Tilemap,
  entityTypes: EntityType[],
  sprites: Sprite[],
  paletteColours: string[],
  selectedEntityId: string | null,
): void {
  const ts = tm.tileSize;

  for (const entity of tm.entities) {
    const type = entityTypes.find((t) => t.id === entity.typeId);
    if (!type) continue;

    const sprite = sprites[type.spriteIndex];
    const isSelected = entity.id === selectedEntityId;

    // Draw entity sprite
    if (sprite) {
      const src = document.createElement('canvas');
      src.width = sprite.width;
      src.height = sprite.height;
      const sctx = src.getContext('2d')!;
      sctx.putImageData(sprite.toImageData(paletteColours), 0, 0);
      ctx.drawImage(src, entity.x, entity.y, ts, ts);
    }

    // Bounding box
    ctx.strokeStyle = isSelected ? '#ffffff' : type.color;
    ctx.lineWidth = isSelected ? (2 / ((ctx as any).__zoom ?? 1)) : (1 / ((ctx as any).__zoom ?? 1));
    ctx.strokeRect(entity.x, entity.y, ts, ts);

    // Selection highlight
    if (isSelected) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.fillRect(entity.x, entity.y, ts, ts);
    }

    // Small label below
    ctx.fillStyle = type.color;
    ctx.font = `${Math.max(8, 10 / ((ctx as any).__zoom ?? 1))}px sans-serif`;
    ctx.fillText(type.behaviorType, entity.x, entity.y + ts + 10 / ((ctx as any).__zoom ?? 1));
  }
}
