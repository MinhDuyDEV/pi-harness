/**
 * HTMLTemplate — generates the complete HTML page that wraps the
 * self-contained game runtime with embedded data.
 */

export class HTMLTemplate {
  /**
   * Generate the full HTML string.
   * @param gameName  Project name for the start screen
   * @param gameDataJson  Compact JSON string of packed game data
   * @param runtimeJs  Runtime JavaScript source
   */
  static generate(
    gameName: string,
    gameDataJson: string,
    runtimeJs: string,
  ): string {
    const safeName = this._escapeHtml(gameName || 'Untitled Game');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeName}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
#game-canvas{display:block;width:100%;height:100%;image-rendering:pixelated}
#start-screen{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0d1117;z-index:10;cursor:pointer;gap:16px;user-select:none}
#start-screen h1{font-size:32px;color:#c9d1d9;font-weight:700;letter-spacing:-0.02em;text-align:center}
#start-screen .subtitle{font-size:14px;color:#8b949e;text-align:center}
#start-screen .prompt{font-size:16px;color:#58a6ff;margin-top:8px;animation:pulse 1.5s ease-in-out infinite}
#start-screen .prompt-small{font-size:12px;color:#8b949e;margin-top:4px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
</style>
</head>
<body>
<div id="start-screen">
  <h1>${safeName}</h1>
  <div class="subtitle">A Retro Game Maker creation</div>
  <div class="prompt">▶ Click or press Enter to start</div>
  <div class="prompt-small">Arrow keys / WASD to move</div>
</div>
<canvas id="game-canvas"></canvas>
<script>
var GAME_DATA = ${gameDataJson};
${runtimeJs}
<\/script>
</body>
</html>`;
  }

  private static _escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
