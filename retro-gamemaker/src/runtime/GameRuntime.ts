/**
 * GameRuntime — in-browser game preview that loads the current project
 * and runs a playable level with physics, entities, and HUD.
 *
 * Lifecycle: start() → loop (60fps) → stop() / restart()
 */

import { Tilemap } from '../core/Tilemap';
import { Sprite } from '../core/Sprite';
import { EntityType } from '../core/EntityType';
import { InputManager } from './InputManager';
import { Physics, PhysicsBody } from './Physics';
import { CameraFollow } from './CameraFollow';
import { EntityRunner, GameState } from './EntityRunner';
import { HUD, HUDState } from './HUD';

export type RuntimeStateFlag = 'playing' | 'stopped';

export class GameRuntime {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private input: InputManager;
  private camera: CameraFollow;
  private entityRunner: EntityRunner;
  private hud: HUD;

  private tilemap: Tilemap;
  private sprites: Sprite[];
  private paletteColours: string[];
  private entityTypes: EntityType[];

  // Player
  private playerBody: PhysicsBody | null = null;

  // Game state
  private gameStateValues: GameState;
  private hudState: HUDState;
  private gameTime: number = 0;
  private _state: RuntimeStateFlag = 'stopped';

  // Loop
  private animFrameId: number | null = null;
  private lastTimestamp: number = 0;

  // Initial snapshot for restart
  private readonly initialTilemap: Tilemap;

  constructor(
    canvas: HTMLCanvasElement,
    tilemap: Tilemap,
    sprites: Sprite[],
    paletteColours: string[],
    entityTypes: EntityType[],
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.input = new InputManager();
    this.camera = new CameraFollow();
    this.entityRunner = new EntityRunner();
    this.hud = new HUD();

    this.tilemap = tilemap.clone();
    this.initialTilemap = tilemap.clone();
    this.sprites = sprites;
    this.paletteColours = paletteColours;
    this.entityTypes = entityTypes;

    this.gameStateValues = this.createInitialGameState();
    this.hudState = {
      score: 0,
      health: 3,
      maxHealth: 3,
      gameTime: 0,
    };

    this.resizeCanvas();
  }

  /** Is the runtime currently playing? */
  get state(): RuntimeStateFlag { return this._state; }

  /** Start the game loop. */
  start(): void {
    if (this._state === 'playing') return;
    this.resetToInitial();
    this.input.attach();
    this._state = 'playing';
    this.lastTimestamp = performance.now();
    this.loop(this.lastTimestamp);
  }

  /** Stop the game loop and detach input. */
  stop(): void {
    this._state = 'stopped';
    this.input.detach();
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /** Restart from the initial snapshot. */
  restart(): void {
    this.stop();
    this.resetToInitial();
    this.start();
  }

  /** Clean up resources. */
  dispose(): void {
    this.stop();
  }

  // ── Private ──

  private resetToInitial(): void {
    this.tilemap = this.initialTilemap.clone();
    this.playerBody = null;
    this.gameTime = 0;
    this.gameStateValues = {
      score: 0,
      health: 3,
      playerX: 0,
      playerY: 0,
      playerW: this.tilemap.tileSize,
      playerH: this.tilemap.tileSize,
      collected: new Set(),
      firedTriggers: new Set(),
      patrolDir: new Map(),
    };
    this.hudState = {
      score: 0,
      health: 3,
      maxHealth: 3,
      gameTime: 0,
    };
    this.camera = new CameraFollow();

    this.spawnPlayer();

    // Initialize patrol directions
    for (const entity of this.tilemap.entities) {
      const type = this.entityTypes.find((t) => t.id === entity.typeId);
      if (type?.behaviorType === 'patrol') {
        this.gameStateValues.patrolDir.set(entity.id, 1);
      }
    }
  }

  private spawnPlayer(): void {
    const playerStart = this.tilemap.entities.find(
      (e) => this.entityTypes.find((t) => t.id === e.typeId)?.behaviorType === 'player-start',
    );

    if (playerStart) {
      const ts = this.tilemap.tileSize;
      const hitboxPad = 2;
      this.playerBody = {
        x: playerStart.x + hitboxPad,
        y: playerStart.y + hitboxPad,
        vx: 0,
        vy: 0,
        width: ts - hitboxPad * 2,
        height: ts - hitboxPad * 2,
        useGravity: false,
        onGround: false,
      };
      this.gameStateValues.playerX = this.playerBody.x;
      this.gameStateValues.playerY = this.playerBody.y;
      this.gameStateValues.playerW = this.playerBody.width;
      this.gameStateValues.playerH = this.playerBody.height;

      this.camera.snapTo(playerStart.x + ts / 2, playerStart.y + ts / 2);
    }
  }

  private createInitialGameState(): GameState {
    return {
      score: 0,
      health: 3,
      playerX: 0,
      playerY: 0,
      playerW: this.tilemap.tileSize,
      playerH: this.tilemap.tileSize,
      collected: new Set(),
      firedTriggers: new Set(),
      patrolDir: new Map(),
    };
  }

  private loop = (timestamp: number): void => {
    if (this._state !== 'playing') return;

    const rawDt = (timestamp - this.lastTimestamp) / 1000;
    const dt = Math.min(rawDt, 0.05);
    this.lastTimestamp = timestamp;

    this.resizeCanvas();
    this.update(dt);
    this.render();

    this.input.clearFrame();
    this.animFrameId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    this.gameTime += dt;

    if (this.playerBody) {
      Physics.update(
        this.playerBody,
        dt,
        this.tilemap,
        this.input.left,
        this.input.right,
        this.input.up,
        this.input.down,
      );

      this.gameStateValues.playerX = this.playerBody.x;
      this.gameStateValues.playerY = this.playerBody.y;
      this.gameStateValues.playerW = this.playerBody.width;
      this.gameStateValues.playerH = this.playerBody.height;
    }

    this.entityRunner.update(
      this.tilemap.entities,
      this.entityTypes,
      this.tilemap,
      this.gameStateValues,
      dt,
    );

    this.hudState.score = this.gameStateValues.score;
    this.hudState.health = this.gameStateValues.health;
    this.hudState.gameTime = this.gameTime;

    if (this.playerBody) {
      this.camera.update(
        this.playerBody.x + this.playerBody.width / 2,
        this.playerBody.y + this.playerBody.height / 2,
        dt,
      );
    }
  }

  private render(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const vw = this.camera.viewportWidth;
    const vh = this.camera.viewportHeight;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    this.camera.applyTransform(ctx);

    this.drawCheckerboard(ctx);

    for (const layer of this.tilemap.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      this.drawLayer(ctx, layer);
      ctx.globalAlpha = 1;
    }

    this.drawEntities(ctx);

    ctx.restore();

    this.hud.draw(ctx, this.hudState, vw, vh);
  }

  private drawCheckerboard(ctx: CanvasRenderingContext2D): void {
    const ts = this.tilemap.tileSize;
    const pw = this.tilemap.pixelWidth;
    const ph = this.tilemap.pixelHeight;
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

  private drawLayer(ctx: CanvasRenderingContext2D, layer: import('../core/Layer').Layer): void {
    const ts = this.tilemap.tileSize;
    for (let row = 0; row < this.tilemap.height; row++) {
      for (let col = 0; col < this.tilemap.width; col++) {
        const tileIdx = layer.getTile(col, row);
        if (tileIdx === 0) continue;
        const entry = this.tilemap.tilePalette[tileIdx];
        if (!entry) continue;
        const sprite = this.sprites[entry.spriteIndex];
        if (!sprite) continue;
        const src = document.createElement('canvas');
        src.width = sprite.width;
        src.height = sprite.height;
        const sctx = src.getContext('2d')!;
        sctx.putImageData(sprite.toImageData(this.paletteColours), 0, 0);
        ctx.drawImage(src, col * ts, row * ts, ts, ts);
      }
    }
  }

  private drawEntities(ctx: CanvasRenderingContext2D): void {
    const ts = this.tilemap.tileSize;

    for (const entity of this.tilemap.entities) {
      const type = this.entityTypes.find((t) => t.id === entity.typeId);
      if (!type) continue;

      const sprite = this.sprites[type.spriteIndex];
      if (sprite) {
        const src = document.createElement('canvas');
        src.width = sprite.width;
        src.height = sprite.height;
        const sctx = src.getContext('2d')!;
        sctx.putImageData(sprite.toImageData(this.paletteColours), 0, 0);
        ctx.drawImage(src, entity.x, entity.y, ts, ts);
      }
    }

    if (this.playerBody) {
      const pb = this.playerBody;
      ctx.fillStyle = 'rgba(60, 180, 255, 0.3)';
      ctx.fillRect(pb.x, pb.y, pb.width, pb.height);
    }
  }

  private resizeCanvas(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(parent.clientWidth);
    const h = Math.round(parent.clientHeight);

    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }

    this.camera.setViewport(w, h);
  }
}
