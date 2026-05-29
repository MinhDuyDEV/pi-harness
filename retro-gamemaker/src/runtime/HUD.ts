/**
 * HUD — renders score, health, and other game state overlays
 * on the game canvas using the Canvas 2D API.
 */

export interface HUDState {
  score: number;
  health: number;
  maxHealth: number;
  gameTime: number;
}

export class HUD {
  /**
   * Draw the HUD overlay on the canvas.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    state: HUDState,
    viewportW: number,
    viewportH: number,
  ): void {
    // ---- Score (top-left) ----
    ctx.save();
    ctx.font = 'bold 16px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    // Score background
    const scoreText = `SCORE: ${state.score}`;
    const scoreWidth = ctx.measureText(scoreText).width + 16;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(8, 8, scoreWidth, 28);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(scoreText, 16, 14);

    // ---- Health bar (top-right) ----
    const barWidth = 120;
    const barHeight = 14;
    const barX = viewportW - barWidth - 16;
    const barY = 14;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(barX - 4, barY - 4, barWidth + 8, barHeight + 8);

    // Health bar background
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Health fill
    const healthPct = Math.max(0, Math.min(1, state.health / state.maxHealth));
    const fillColor = healthPct > 0.5 ? '#3fb950' : healthPct > 0.25 ? '#d29922' : '#f85149';
    ctx.fillStyle = fillColor;
    ctx.fillRect(barX, barY, barWidth * healthPct, barHeight);

    // Health label
    ctx.font = '10px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `HP ${state.health}/${state.maxHealth}`,
      barX + barWidth / 2,
      barY + barHeight / 2 + 1,
    );

    // ---- Game time (bottom-right) ----
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    const minutes = Math.floor(state.gameTime / 60);
    const seconds = Math.floor(state.gameTime % 60);
    ctx.fillText(
      `${minutes}:${seconds.toString().padStart(2, '0')}`,
      viewportW - 16,
      viewportH - 16,
    );

    ctx.restore();
  }
}
