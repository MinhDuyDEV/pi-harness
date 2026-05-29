import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sprite } from './core/Sprite';
import { Palette } from './core/Palette';
import { Tilemap } from './core/Tilemap';
import { Entity } from './core/Entity';
import { GameRuntime } from './runtime/GameRuntime';
import { ProjectSerializer, ProjectData } from './core/ProjectSerializer';
import { ProjectStore } from './core/ProjectStore';
import { generateProjectId } from './core/Project';
import { DEFAULT_ENTITY_TYPES, EntityType } from './core/EntityType';
import { PALETTE_PRESETS } from './core/PalettePresets';
import { SpriteEditor, EditorToolId } from './components/SpriteEditor';
import { PaletteManager } from './components/PaletteManager';
import { SpritePreview } from './components/SpritePreview';
import { TilemapEditor, TileEditorTool } from './components/TilemapEditor';
import { TilePalette } from './components/TilePalette';
import { LayerManager } from './components/LayerManager';
import { EntityPalette } from './components/EntityPalette';
import { EntityInspector } from './components/EntityInspector';
import { PlayControls } from './components/PlayControls';
import { Toolbar, ToolDef } from './components/Toolbar';
import { InspectorPanel } from './components/InspectorPanel';
import { NewProjectDialog } from './components/NewProjectDialog';
import { OpenProjectDialog } from './components/OpenProjectDialog';
import { SaveIndicator, SaveState } from './components/SaveIndicator';
import { ExportDialog } from './components/ExportDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import './styles/theme.css';

/* ── Tool definitions ── */

const SPRITE_TOOLS: ToolDef[] = [
  { id: 'pencil', label: 'Pencil (P)', icon: '✎' },
  { id: 'eraser', label: 'Eraser (E)', icon: '✕' },
  { id: 'fill',   label: 'Fill (G)',   icon: '▣' },
  { id: 'picker', label: 'Picker (I)', icon: '◉' },
];

const TILE_TOOLS: ToolDef[] = [
  { id: 'paint',     label: 'Tile Paint (B)',   icon: '⊞' },
  { id: 'erase',     label: 'Tile Erase (E)',   icon: '⊟' },
  { id: 'collision', label: 'Collision (C)',    icon: '⛔' },
  { id: 'entity',    label: 'Entity (Y)',       icon: '◆' },
];

type AppMode = 'sprite' | 'tilemap';

const DEFAULT_PALETTE = new Palette(PALETTE_PRESETS.find((p) => p.name === 'PICO-8')!.colours);
const DEFAULT_ENTITY_TYPES_FROZEN: EntityType[] = DEFAULT_ENTITY_TYPES;

function createDefaultTilemap(): Tilemap {
  const tm = new Tilemap(32, 32, 16);
  tm.addLayer('Collision (non-rendered)');
  return tm;
}

const App: React.FC = () => {
  // ── Project metadata ──
  const [projectId, setProjectId] = useState(generateProjectId);
  const [projectName, setProjectName] = useState('Untitled');
  const [projectAuthor, setProjectAuthor] = useState('');
  const [projectCreatedAt, setProjectCreatedAt] = useState(new Date().toISOString());
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // ── Dialogs ──
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showOpenDialog, setShowOpenDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // ── Mode ──
  const [mode, setMode] = useState<AppMode>('tilemap');

  // ── Colour palette ──
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [activeColourIndex, setActiveColourIndex] = useState(1);

  // ── Project sprites ──
  const [projectSprites, setProjectSprites] = useState<Sprite[]>([new Sprite(16, 16)]);
  const [activeSpriteIndex] = useState(0);
  const activeSprite = projectSprites[activeSpriteIndex] ?? projectSprites[0];

  // ── Entity types ──
  const [entityTypes, setEntityTypes] = useState<EntityType[]>(DEFAULT_ENTITY_TYPES_FROZEN);

  // ── Tilemap state ──
  const [tilemap, setTilemap] = useState(createDefaultTilemap);
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
  const [activeTileIndex, setActiveTileIndex] = useState(0);
  const [activeTileTool, setActiveTileTool] = useState<TileEditorTool>('paint');

  // ── Entity editing state ──
  const [activeEntityTypeId, setActiveEntityTypeId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // ── Play mode ──
  const [isPlaying, setIsPlaying] = useState(false);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const runtimeCanvasRef = useRef<HTMLCanvasElement>(null);

  // ── Auto-save debounce ──
  const autoSaveTimer = useRef<number | null>(null);
  const isInitialMount = useRef(true);

  const collectProjectData = useCallback((): ProjectData => ({
    id: projectId,
    name: projectName,
    author: projectAuthor,
    createdAt: projectCreatedAt,
    modifiedAt: new Date().toISOString(),
    palette,
    sprites: projectSprites,
    tilemap,
    entityTypes,
  }), [projectId, projectName, projectAuthor, projectCreatedAt, palette, projectSprites, tilemap, entityTypes]);

  // Auto-save debounce
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current !== null) {
      clearTimeout(autoSaveTimer.current);
    }
    autoSaveTimer.current = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        const data = collectProjectData();
        const json = ProjectSerializer.toJSON(data);
        await ProjectStore.save(json);
        setSaveState('saved');
        setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000);
      } catch {
        setSaveState('error');
      }
    }, 800);
  }, [collectProjectData]);

  // Track changes for auto-save (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    triggerAutoSave();
  }, [palette, projectSprites, tilemap, projectName, projectAuthor, triggerAutoSave]);

  // ── Project operations ──

  const handleNewProject = useCallback((name: string, author: string) => {
    setShowNewDialog(false);
    setProjectId(generateProjectId());
    setProjectName(name || 'Untitled');
    setProjectAuthor(author || '');
    setProjectCreatedAt(new Date().toISOString());
    setPalette(DEFAULT_PALETTE.clone());
    setProjectSprites([new Sprite(16, 16)]);
    setTilemap(createDefaultTilemap());
    setActiveTileTool('paint');
    setActiveLayerIndex(0);
    setActiveTileIndex(0);
    setSelectedEntityId(null);
    setActiveEntityTypeId(null);
    setSaveState('idle');
  }, []);

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    try {
      const data = collectProjectData();
      const json = ProjectSerializer.toJSON(data);
      await ProjectStore.save(json);
      setSaveState('saved');
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000);
    } catch {
      setSaveState('error');
    }
  }, [collectProjectData]);

  const handleOpen = useCallback(async (id: string) => {
    setShowOpenDialog(false);
    try {
      const json = await ProjectStore.load(id);
      const data = ProjectSerializer.fromJSON(json);
      setProjectId(data.id);
      setProjectName(data.name);
      setProjectAuthor(data.author);
      setProjectCreatedAt(data.createdAt);
      setPalette(data.palette);
      setProjectSprites(data.sprites);
      setTilemap(data.tilemap);
      setEntityTypes(data.entityTypes);
      setActiveLayerIndex(0);
      setSelectedEntityId(null);
      setActiveEntityTypeId(null);
      setSaveState('idle');
    } catch (err) {
      console.error('Failed to load project:', err);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await ProjectStore.delete(id);
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
    setPendingDeleteId(null);
    setShowDeleteConfirm(false);
  }, []);

  const handleExport = useCallback(() => {
    const data = collectProjectData();
    const jsonStr = ProjectSerializer.exportToFile(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.retrogame`;
    a.click();
    URL.revokeObjectURL(url);
  }, [collectProjectData, projectName]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.retrogame,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        const data = ProjectSerializer.importFromFile(content);
        setProjectId(data.id);
        setProjectName(data.name);
        setProjectAuthor(data.author);
        setProjectCreatedAt(data.createdAt);
        setPalette(data.palette);
        setProjectSprites(data.sprites);
        setTilemap(data.tilemap);
        setEntityTypes(data.entityTypes);
        setActiveLayerIndex(0);
        setSelectedEntityId(null);
        setActiveEntityTypeId(null);
        setSaveState('idle');
      } catch (err) {
        console.error('Failed to import project:', err);
        alert('Failed to import project. The file may be corrupted or from an incompatible version.');
      }
    };
    input.click();
  }, []);

  // ── Handlers ──

  const handleSpriteChange = useCallback((newSprite: Sprite) => {
    setProjectSprites((prev) => {
      const copy = [...prev];
      copy[0] = newSprite;
      return copy;
    });
  }, []);

  const handlePaletteChange = useCallback((newPalette: Palette) => {
    setPalette(newPalette);
    if (activeColourIndex > newPalette.length) {
      setActiveColourIndex(Math.max(1, newPalette.length));
    }
  }, [activeColourIndex]);

  const handleToolSelect = useCallback((toolId: string) => {
    if (mode === 'sprite') {
      setActiveToolId(toolId as EditorToolId);
    } else {
      setActiveTileTool(toolId as TileEditorTool);
      if (toolId !== 'entity') setActiveEntityTypeId(null);
    }
  }, [mode]);

  const [activeToolId, setActiveToolId] = useState<EditorToolId>('pencil');

  const handleModeChange = useCallback((newMode: AppMode) => {
    setMode(newMode);
    setSelectedEntityId(null);
    setActiveEntityTypeId(null);
  }, []);

  const handleTilemapChange = useCallback((newTilemap: Tilemap) => {
    setTilemap(newTilemap);
  }, []);

  const handleTilePaletteChange = useCallback(
    (pal: (import('./core/Tilemap').TilePaletteEntry | null)[]) => {
      setTilemap((prev) => {
        const clone = prev.clone();
        clone.tilePalette = pal;
        return clone;
      });
    },
    [],
  );

  const handleLayersChange = useCallback(
    (layers: import('./core/Layer').Layer[]) => {
      setTilemap((prev) => {
        const clone = prev.clone();
        clone.layers = layers;
        return clone;
      });
      setActiveLayerIndex((i) => Math.min(i, layers.length - 1));
    },
    [],
  );

  // ── Entity handlers ──

  const handleEntitySelect = useCallback((entityId: string | null) => {
    setSelectedEntityId(entityId);
  }, []);

  const handleUpdateEntity = useCallback(
    (id: string, changes: Partial<Entity>) => {
      setTilemap((prev) => {
        const clone = prev.clone();
        const entity = clone.entities.find((e) => e.id === id);
        if (!entity) return prev;
        if (changes.x !== undefined) entity.x = changes.x;
        if (changes.y !== undefined) entity.y = changes.y;
        if (changes.properties !== undefined) entity.properties = changes.properties;
        return clone;
      });
    },
    [],
  );

  const handleDeleteEntity = useCallback((id: string) => {
    setTilemap((prev) => {
      const clone = prev.clone();
      const idx = clone.entities.findIndex((e) => e.id === id);
      if (idx >= 0) clone.entities.splice(idx, 1);
      return clone;
    });
    setSelectedEntityId((current) => (current === id ? null : current));
  }, []);

  const handleDuplicateEntity = useCallback((id: string) => {
    setTilemap((prev) => {
      if (!prev.canAddEntity) return prev;
      const clone = prev.clone();
      const entity = clone.entities.find((e) => e.id === id);
      if (!entity) return prev;
      const dup = entity.clone();
      dup.x += 16;
      dup.y += 16;
      clone.entities.push(dup);
      return clone;
    });
  }, []);

  const handleReorderEntity = useCallback(
    (fromIndex: number, toIndex: number) => {
      setTilemap((prev) => {
        const clone = prev.clone();
        const [e] = clone.entities.splice(fromIndex, 1);
        clone.entities.splice(toIndex, 0, e);
        return clone;
      });
    },
    [],
  );

  // ── Play mode handlers ──

  const handlePlay = useCallback(() => {
    const canvas = runtimeCanvasRef.current;
    if (!canvas) return;
    if (runtimeRef.current) runtimeRef.current.dispose();

    const runtime = new GameRuntime(
      canvas,
      tilemap,
      projectSprites,
      palette.colours,
      entityTypes,
    );
    runtimeRef.current = runtime;
    runtime.start();
    setIsPlaying(true);
  }, [tilemap, projectSprites, palette, entityTypes]);

  const handleStop = useCallback(() => {
    if (runtimeRef.current) {
      runtimeRef.current.dispose();
      runtimeRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const handleRestart = useCallback(() => {
    runtimeRef.current?.restart();
  }, []);

  useEffect(() => {
    return () => { runtimeRef.current?.dispose(); };
  }, []);

  return (
    <div className="app-layout">
      {/* ===== File menu bar ===== */}
      {!isPlaying && (
        <div className="menu-bar">
          <button className="menu-btn" onClick={() => setShowNewDialog(true)} title="New Project">
            📄 New
          </button>
          <button className="menu-btn" onClick={handleSave} title="Save to IndexedDB (Ctrl+S)">
            💾 Save
          </button>
          <button className="menu-btn" onClick={() => setShowOpenDialog(true)} title="Open project">
            📂 Open
          </button>
          <button className="menu-btn" onClick={() => setShowExportDialog(true)} title="Export as standalone HTML game">
            🎮 Export Game
          </button>
          <button className="menu-btn" onClick={handleExport} title="Export as .retrogame file">
            📤 Export Data
          </button>
          <button className="menu-btn" onClick={handleImport} title="Import .retrogame file">
            📥 Import
          </button>
          <div className="menu-bar-spacer" />
          <SaveIndicator state={saveState} projectName={projectName} />
        </div>
      )}

      {/* Left toolbar */}
      {!isPlaying && (
        <Toolbar
          tools={mode === 'sprite' ? SPRITE_TOOLS : TILE_TOOLS}
          activeTool={mode === 'sprite' ? activeToolId : activeTileTool}
          onToolSelect={handleToolSelect}
        >
          <button
            className={`toolbar-btn mode-btn ${mode === 'sprite' ? 'active' : ''}`}
            onClick={() => handleModeChange('sprite')}
            title="Sprite Editor"
          >
            🎨
          </button>
          <button
            className={`toolbar-btn mode-btn ${mode === 'tilemap' ? 'active' : ''}`}
            onClick={() => handleModeChange('tilemap')}
            title="Tilemap Editor"
          >
            🗺
          </button>
          <div className="toolbar-separator" />
        </Toolbar>
      )}

      {/* Center: editor or runtime */}
      <div className="canvas-viewport">
        {isPlaying ? (
          <canvas ref={runtimeCanvasRef} className="runtime-canvas" />
        ) : mode === 'sprite' ? (
          <SpriteEditor
            sprite={activeSprite}
            palette={palette}
            activeToolId={activeToolId}
            activeColourIndex={activeColourIndex}
            onSpriteChange={handleSpriteChange}
            onActiveColourChange={setActiveColourIndex}
          />
        ) : (
          <>
            <PlayControls isPlaying={false} onPlay={handlePlay} onStop={handleStop} onRestart={handleRestart} />
            <TilemapEditor
              tilemap={tilemap}
              projectSprites={projectSprites}
              paletteColours={palette.colours}
              activeTool={activeTileTool}
              activeTileIndex={activeTileIndex}
              activeLayerIndex={activeLayerIndex}
              entityTypes={entityTypes}
              activeEntityTypeId={activeEntityTypeId}
              selectedEntityId={selectedEntityId}
              onTilemapChange={handleTilemapChange}
              onEntitySelect={handleEntitySelect}
            />
          </>
        )}
      </div>

      {/* Right panel */}
      {isPlaying ? (
        <div className="right-panel" role="complementary" aria-label="Game controls">
          <div className="play-sidebar">
            <PlayControls isPlaying={true} onPlay={handlePlay} onStop={handleStop} onRestart={handleRestart} />
            <div className="play-sidebar-info">
              <p>Use <kbd>Arrow Keys</kbd> or <kbd>WASD</kbd> to move.</p>
              <p>Collect coins and gems for points.</p>
              <p>Press <kbd>Stop</kbd> to return.</p>
            </div>
          </div>
        </div>
      ) : mode === 'sprite' ? (
        <div className="right-panel" role="complementary" aria-label="Side panel">
          <PaletteManager palette={palette} activeColourIndex={activeColourIndex} onSelectColour={setActiveColourIndex} onPaletteChange={handlePaletteChange} />
          <SpritePreview sprite={activeSprite} palette={palette.colours} />
          <InspectorPanel activeTool={activeToolId} zoom={1} cameraX={0} cameraY={0} />
        </div>
      ) : (
        <div className="right-panel" role="complementary" aria-label="Side panel">
          {activeTileTool === 'entity' ? (
            <>
              <EntityPalette entityTypes={entityTypes} projectSprites={projectSprites} activeEntityTypeId={activeEntityTypeId} onSelectEntityType={setActiveEntityTypeId} paletteColours={palette.colours} />
              <EntityInspector entities={tilemap.entities} entityTypes={entityTypes} selectedEntityId={selectedEntityId} onSelectEntity={handleEntitySelect} onUpdateEntity={handleUpdateEntity} onDeleteEntity={handleDeleteEntity} onDuplicateEntity={handleDuplicateEntity} onReorderEntity={handleReorderEntity} tileSize={tilemap.tileSize} />
            </>
          ) : (
            <>
              <TilePalette tilePalette={tilemap.tilePalette} projectSprites={projectSprites} activeTileIndex={activeTileIndex} onActiveTileChange={setActiveTileIndex} onTilePaletteChange={handleTilePaletteChange} paletteColours={palette.colours} />
              <LayerManager layers={tilemap.layers} activeLayerIndex={activeLayerIndex} onActiveLayerChange={setActiveLayerIndex} onLayersChange={handleLayersChange} />
              <InspectorPanel activeTool={activeTileTool} zoom={1} cameraX={0} cameraY={0} />
            </>
          )}
        </div>
      )}

      {/* ── Dialogs ── */}
      <NewProjectDialog open={showNewDialog} onConfirm={handleNewProject} onCancel={() => setShowNewDialog(false)} />
      <OpenProjectDialog open={showOpenDialog} onSelect={handleOpen} onDelete={(id) => { setPendingDeleteId(id); setShowDeleteConfirm(true); }} onCancel={() => setShowOpenDialog(false)} />
      <ConfirmDialog open={showDeleteConfirm} title="Delete Project" message="Are you sure you want to delete this project? This action cannot be undone." confirmLabel="Delete" onConfirm={() => pendingDeleteId && handleDelete(pendingDeleteId)} onCancel={() => { setShowDeleteConfirm(false); setPendingDeleteId(null); }} />
      <ExportDialog
        open={showExportDialog}
        projectName={projectName}
        sprites={projectSprites}
        palette={palette}
        tilemap={tilemap}
        entities={tilemap.entities}
        entityTypes={entityTypes}
        onClose={() => setShowExportDialog(false)}
      />
    </div>
  );
};

export default App;
