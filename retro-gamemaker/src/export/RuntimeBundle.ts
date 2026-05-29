/**
 * RuntimeBundle — returns the JavaScript source string for the self-contained
 * game runtime embedded in the exported HTML file.
 *
 * The runtime is a single IIFE with no imports or dependencies.
 */

export class RuntimeBundle {
  /** Generate the full runtime JavaScript source. */
  static generate(): string {
    return `
(function() {
  'use strict';

  /* ─── Runtime v1 ─── */

  var G = window.GAME_DATA;
  var canvas, ctx, vw, vh;

  // Pre-render sprites to off-screen canvases
  var spriteCanvases = [];
  function initSprites() {
    for (var i = 0; i < G.sprites.length; i++) {
      var s = G.sprites[i];
      var c = document.createElement('canvas');
      c.width = s.w;
      c.height = s.h;
      var cx = c.getContext('2d');
      var imgData = cx.createImageData(s.w, s.h);
      for (var j = 0; j < s.p.length; j++) {
        var idx = s.p[j];
        var off = j * 4;
        if (idx === 0 || idx >= G.palette.length) {
          imgData.data[off] = 0;
          imgData.data[off+1] = 0;
          imgData.data[off+2] = 0;
          imgData.data[off+3] = 0;
        } else {
          var hex = G.palette[idx];
          imgData.data[off] = parseInt(hex.slice(1,3), 16);
          imgData.data[off+1] = parseInt(hex.slice(3,5), 16);
          imgData.data[off+2] = parseInt(hex.slice(5,7), 16);
          imgData.data[off+3] = 255;
        }
      }
      cx.putImageData(imgData, 0, 0);
      spriteCanvases.push(c);
    }
  }

  // Tile rendering cache
  var tileCanvases = {};

  function getTileCanvas(tileIdx) {
    if (tileCanvases[tileIdx]) return tileCanvases[tileIdx];
    var entry = G.tilemap.tilePalette[tileIdx];
    if (!entry) return null;
    var sc = spriteCanvases[entry.si];
    if (!sc) return null;
    var ts = G.tilemap.ts;
    var c = document.createElement('canvas');
    c.width = ts;
    c.height = ts;
    var cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(sc, 0, 0, ts, ts);
    tileCanvases[tileIdx] = c;
    return c;
  }

  // ─── Input ───
  var keys = {};
  var justPressed = {};

  function initInput() {
    window.addEventListener('keydown', function(e) {
      if (!keys[e.code]) justPressed[e.code] = true;
      keys[e.code] = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code) >= 0) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', function(e) {
      keys[e.code] = false;
    });
  }

  function clearFrame() { justPressed = {}; }

  // ─── Collision ───
  function isSolid(col, row) {
    if (col < 0 || col >= G.tilemap.w || row < 0 || row >= G.tilemap.h) return true;
    return G.tilemap.collision[row * G.tilemap.w + col] === 1;
  }

  function resolveCollision(x, y, w, h) {
    var ts = G.tilemap.ts;
    var x1 = Math.floor(x / ts);
    var y1 = Math.floor(y / ts);
    var x2 = Math.floor((x + w - 0.01) / ts);
    var y2 = Math.floor((y + h - 0.01) / ts);
    for (var row = y1; row <= y2; row++) {
      for (var col = x1; col <= x2; col++) {
        if (!isSolid(col, row)) continue;
        var tl = col * ts;
        var tr = tl + ts;
        var tt = row * ts;
        var tb = tt + ts;
        var ol = (x + w) - tl;
        var ori = tr - x;
        var ot = (y + h) - tt;
        var ob = tb - y;
        var min = Math.min(ol, ori, ot, ob);
        if (min === ol) x = tl - w;
        else if (min === ori) x = tr;
        else if (min === ot) y = tt - h;
        else if (min === ob) y = tb;
      }
    }
    return { x: x, y: y };
  }

  // ─── Player ───
  var player = null;
  var PLAYER_SPEED = 120;
  var SCORE = 0;
  var HEALTH = 3;
  var MAX_HEALTH = 3;
  var collected = {};
  var patrolDir = {};
  var firedTriggers = {};

  function spawnPlayer() {
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      if (e.ti === 'player-start') {
        var pad = 2;
        var ts = G.tilemap.ts;
        player = {
          x: e.x + pad,
          y: e.y + pad,
          vx: 0,
          vy: 0,
          w: ts - pad * 2,
          h: ts - pad * 2
        };
        return;
      }
    }
  }

  function updatePlayer(dt) {
    if (!player) return;
    var vx = 0, vy = 0;
    if (keys.ArrowLeft || keys.KeyA) vx = -PLAYER_SPEED;
    else if (keys.ArrowRight || keys.KeyD) vx = PLAYER_SPEED;
    if (keys.ArrowUp || keys.KeyW) vy = -PLAYER_SPEED;
    else if (keys.ArrowDown || keys.KeyS) vy = PLAYER_SPEED;

    player.vx = vx;
    player.vy = vy;

    var nx = player.x + vx * dt;
    var ny = player.y + vy * dt;

    nx = Math.max(0, Math.min(G.tilemap.w * G.tilemap.ts - player.w, nx));
    ny = Math.max(0, Math.min(G.tilemap.h * G.tilemap.ts - player.h, ny));

    var rx = resolveCollision(nx, player.y, player.w, player.h);
    nx = rx.x;
    player.x = nx;

    var ry = resolveCollision(player.x, ny, player.w, player.h);
    ny = ry.y;
    player.y = ny;
  }

  // ─── Camera ───
  var camX = 0, camY = 0;
  var CAM_SMOOTH = 4;

  function updateCamera(dt) {
    if (!player) return;
    var tx = player.x + player.w / 2;
    var ty = player.y + player.h / 2;
    var lerp = 1 - Math.exp(-CAM_SMOOTH * dt);
    camX += (tx - camX) * lerp;
    camY += (ty - camY) * lerp;
  }

  // ─── Entities ───
  function updateEntities(dt) {
    // Patrol
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      var type = getEntityType(e.ti);
      if (!type || type.bt !== 'patrol') continue;
      var dir = patrolDir[e.ti + '_' + i] || 1;
      var speed = (e.props.speed || 1) * 60;
      var range = (e.props.patrolRange || 3) * G.tilemap.ts;
      var isHoriz = e.props.direction !== 'vertical';
      var dx = isHoriz ? dir * speed * dt : 0;
      var dy = isHoriz ? 0 : dir * speed * dt;
      var nx = e.x + dx;
      var ny = e.y + dy;
      var dist = isHoriz ? Math.abs(nx - e.x) : Math.abs(ny - e.y);
      var hit = resolveCollision(nx, ny, G.tilemap.ts, G.tilemap.ts);
      if (hit.x !== nx || hit.y !== ny || dist > range) {
        patrolDir[e.ti + '_' + i] = -dir;
      } else {
        e.x = nx;
        e.y = ny;
      }
    }

    // Collectibles
    for (i = G.entities.length - 1; i >= 0; i--) {
      e = G.entities[i];
      type = getEntityType(e.ti);
      if (!type || type.bt !== 'collectible') continue;
      if (collected[i]) { G.entities.splice(i, 1); continue; }
      if (player && rectsOverlap(player.x, player.y, player.w, player.h, e.x, e.y, G.tilemap.ts, G.tilemap.ts)) {
        collected[i] = true;
        SCORE += (e.props.collectibleType === 'gem' ? 500 : 100);
        G.entities.splice(i, 1);
      }
    }

    // Trigger zones
    for (i = 0; i < G.entities.length; i++) {
      e = G.entities[i];
      type = getEntityType(e.ti);
      if (!type || type.bt !== 'trigger-zone') continue;
      if (firedTriggers[i]) continue;
      var radius = e.props.triggerRadius || 32;
      if (player) {
        var dx2 = (player.x + player.w/2) - e.x;
        var dy2 = (player.y + player.h/2) - e.y;
        if (Math.sqrt(dx2*dx2 + dy2*dy2) <= radius) {
          firedTriggers[i] = true;
          SCORE += 50;
        }
      }
    }
  }

  function getEntityType(typeId) {
    for (var i = 0; i < G.entityTypes.length; i++) {
      if (G.entityTypes[i].id === typeId) return G.entityTypes[i];
    }
    return null;
  }

  function rectsOverlap(x1,y1,w1,h1, x2,y2,w2,h2) {
    return x1 < x2+w2 && x1+w1 > x2 && y1 < y2+h2 && y1+h1 > y2;
  }

  // ─── Render ───
  function render() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(2, 2);
    ctx.translate(-camX, -camY);

    // Tiles
    var ts = G.tilemap.ts;
    for (var li = 0; li < G.tilemap.layers.length; li++) {
      var layer = G.tilemap.layers[li];
      if (layer.opacity <= 0) continue;
      ctx.globalAlpha = layer.opacity;
      for (var row = 0; row < G.tilemap.h; row++) {
        for (var col = 0; col < G.tilemap.w; col++) {
          var ti = layer.tiles[row * G.tilemap.w + col];
          if (ti === 0) continue;
          var tc = getTileCanvas(ti);
          if (tc) ctx.drawImage(tc, col * ts, row * ts);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Entities
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      var type = getEntityType(e.ti);
      if (!type) continue;
      var sc = spriteCanvases[type.si];
      if (sc) ctx.drawImage(sc, e.x, e.y, ts, ts);
    }

    // Player
    if (player) {
      var psc = spriteCanvases[0];
      if (psc) ctx.drawImage(psc, player.x, player.y, ts, ts);
    }

    ctx.restore();

    // HUD
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.font = 'bold 16px monospace';
    ctx.textBaseline = 'top';
    var st = 'SCORE: ' + SCORE;
    var sw = ctx.measureText(st).width;
    ctx.fillRect(8, 8, sw + 16, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(st, 16, 14);

    // Health bar
    var bx = vw - 140, by = 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 4, by - 4, 136, 22);
    ctx.fillStyle = '#333';
    ctx.fillRect(bx, by, 128, 14);
    var pct = Math.max(0, Math.min(1, HEALTH / MAX_HEALTH));
    ctx.fillStyle = pct > 0.5 ? '#3fb950' : pct > 0.25 ? '#d29922' : '#f85149';
    ctx.fillRect(bx, by, 128 * pct, 14);
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HP ' + HEALTH + '/' + MAX_HEALTH, bx + 64, by + 7);
  }

  // ─── Game Loop ───
  var running = false;
  var lastTime = 0;

  function loop(time) {
    if (!running) return;
    var dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    resizeCanvas();
    updatePlayer(dt);
    updateEntities(dt);
    updateCamera(dt);
    render();

    clearFrame();
    requestAnimationFrame(loop);
  }

  function resizeCanvas() {
    var w = canvas.parentElement.clientWidth || window.innerWidth;
    var h = canvas.parentElement.clientHeight || window.innerHeight;
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    vw = w;
    vh = h;
  }

  // ─── Start Screen ───
  function showStartScreen() {
    var overlay = document.getElementById('start-screen');
    if (overlay) overlay.style.display = 'flex';
  }

  function hideStartScreen() {
    var overlay = document.getElementById('start-screen');
    if (overlay) overlay.style.display = 'none';
  }

  function startGame() {
    hideStartScreen();
    if (running) return;
    running = true;
    lastTime = performance.now();
    resizeCanvas();
    requestAnimationFrame(loop);
  }

  // ─── Init ───
  function init() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    initSprites();
    initInput();
    spawnPlayer();

    // Reset state
    SCORE = 0;
    HEALTH = 3;
    collected = {};
    patrolDir = {};
    firedTriggers = {};

    // Initial camera snap
    if (player) {
      camX = player.x + player.w / 2;
      camY = player.y + player.h / 2;
    }

    resizeCanvas();

    var overlay = document.getElementById('start-screen');
    if (overlay) {
      overlay.addEventListener('click', startGame);
      overlay.style.display = 'flex';
    }

    window.addEventListener('keydown', function onFirstKey(e) {
      if (e.code === 'Enter' || e.code === 'Space') {
        startGame();
        window.removeEventListener('keydown', onFirstKey);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
  }
}
