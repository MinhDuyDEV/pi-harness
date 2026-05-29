import { describe, it, expect } from 'vitest';
import { Sprite } from '../core/Sprite';
import { Palette } from '../core/Palette';
import { Tilemap } from '../core/Tilemap';
import { Entity } from '../core/Entity';
import { EntityType } from '../core/EntityType';
import { ExportEngine } from '../export/ExportEngine';

const SAMPLE_ENTITY_TYPES: EntityType[] = [
  {
    id: 'player-start',
    name: 'Player Start',
    behaviorType: 'player-start',
    spriteIndex: 0,
    color: '#3fb950',
    description: '',
    defaultProperties: {},
  },
];

describe('ExportEngine', () => {
  function makeSampleData() {
    const sprites = [new Sprite(8, 8)];
    const palette = new Palette(['#ff0000', '#00ff00']);
    const tilemap = new Tilemap(10, 10, 16);
    const entities = [new Entity('player-start', 32, 32)];
    return { sprites, palette, tilemap, entities };
  }

  it('generates an HTML export', () => {
    const { sprites, palette, tilemap, entities } = makeSampleData();
    const result = ExportEngine.export('Test Game', sprites, palette, tilemap, entities, SAMPLE_ENTITY_TYPES);

    expect(result.html).toBeTruthy();
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('Test Game');
    expect(result.html).toContain('GAME_DATA');
    expect(result.html).toContain('game-canvas');
    expect(result.sizeBytes).toBeGreaterThan(1000);
    expect(result.spriteCount).toBe(1);
    expect(result.tileCount).toBe(100); // 10×10
    expect(result.entityCount).toBe(1);
  });

  it('includes start screen with project name', () => {
    const { sprites, palette, tilemap, entities } = makeSampleData();
    const result = ExportEngine.export('My Game', sprites, palette, tilemap, entities, SAMPLE_ENTITY_TYPES);
    expect(result.html).toContain('My Game');
    expect(result.html).toContain('start-screen');
    expect(result.html).toContain('Click or press Enter to start');
  });

  it('includes runtime code', () => {
    const { sprites, palette, tilemap, entities } = makeSampleData();
    const result = ExportEngine.export('Test', sprites, palette, tilemap, entities, SAMPLE_ENTITY_TYPES);
    expect(result.html).toContain('GAME_DATA');
    expect(result.html).toContain('function updatePlayer');
    expect(result.html).toContain('function render');
    expect(result.html).toContain('function loop');
  });

  it('analyzes project and returns suggestions', () => {
    const { sprites, tilemap, entities } = makeSampleData();
    const suggestions = ExportEngine.analyze(sprites, tilemap, entities);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.type === 'success' || s.type === 'info')).toBe(true);
  });

  it('download creates an anchor element', () => {
    const { sprites, palette, tilemap, entities } = makeSampleData();
    const result = ExportEngine.export('Test', sprites, palette, tilemap, entities, SAMPLE_ENTITY_TYPES);

    // Mock document.createElement
    const originalCreateElement = document.createElement.bind(document);
    let createdAnchor: HTMLAnchorElement | null = null;
    document.createElement = ((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') createdAnchor = el as HTMLAnchorElement;
      return el;
    }) as typeof document.createElement;

    ExportEngine.download(result.html, 'Test');

    expect(createdAnchor).not.toBeNull();
    expect(createdAnchor!.download).toBe('Test.html');
    expect(createdAnchor!.href).toBeTruthy();

    document.createElement = originalCreateElement;
  });
});
