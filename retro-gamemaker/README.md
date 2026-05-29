# Retro Game Maker 🎮

A browser-based pixel-art game editor and runtime. Create sprites, build tile-based levels, place interactive entities, and export standalone HTML games — all in your browser.

![Screenshot](docs/screenshot.png)

## Features

### 🎨 Sprite Editor
- Pixel-level drawing with configurable canvas sizes (8×8 up to 64×64)
- Pencil, eraser, flood fill, and eyedropper tools
- Unlimited undo/redo
- Real-time preview at 1×, 2×, 4× zoom

### 🗺️ Tilemap Editor
- Multi-layer tile maps (background, foreground, collision)
- Paint/erase tiles, configure opacity per layer
- Map scrolling and zoom (middle-click pan + scroll wheel)
- Auto-scroll when painting near viewport edges

### 👾 Entity System
- Place interactive entities: player spawn, enemies, collectibles, triggers
- Built-in behaviors: static, patrol, collectible, spawn point, trigger zone
- Entity inspector with position editing and behavior parameter configuration

### ▶️ Play Mode
- In-browser game preview with 60fps runtime
- WASD/arrow key controls for the player
- Tile collision, collectible pickups, patrol enemies, trigger zones
- HUD with score display and health bar

### 🎮 Game Export
- Export as a single self-contained HTML file (no dependencies)
- Embedded game engine with full functionality
- Start screen with project name
- Runs in any modern browser

### 🎵 Sound Effects
- 8-bit waveform generator (square, triangle, sawtooth, noise)
- ADSR envelope editor with real-time preview
- Assign sounds to game events (collect, jump, hit, death)

### 🤖 AI Features
- Generate sprites from text descriptions
- Generate levels from natural language prompts
- AI-powered entity placement suggestions
- Custom behavior script generation
- API key configuration in settings panel

### 📦 Import/Export
- Import PNG spritesheets with auto-detect or custom grid
- Import Tiled (.tmx) maps
- Save/Load projects via IndexedDB
- Export/Import `.retrogame` project files
- Auto-save with debounce

## Getting Started

### Prerequisites
- Node.js 18+
- npm 9+

### Installation

```bash
cd retro-gamemaker
npm install
```

### Development

```bash
npm run dev
```

Opens at `http://localhost:3000` with hot reload.

### Production Build

```bash
npm run build
npm run preview
```

### Testing

```bash
# Unit tests
npm test

# Unit tests in watch mode
npm run test:watch

# E2E tests (requires Playwright)
npx playwright install chromium
npm run test:e2e
```

## Quick Start

1. **Create a sprite**: Switch to Sprite Editor mode (🎨), draw a 16×16 pixel character
2. **Assign to tile palette**: Switch to Tilemap Editor (🗺️), add a tile slot, assign your sprite
3. **Paint a level**: Select the tile and paint on the map layers
4. **Place entities**: Switch to Entity tool (◆), select an entity type, click to place
5. **Play**: Click the Play button (▶) to test your game
6. **Export**: Go to File → Export Game to generate a standalone HTML file

## Project Structure

```
src/
├── core/          # Domain models
├── renderer/      # Canvas rendering pipeline
├── tools/         # Editor tools
├── components/    # React UI components
├── runtime/       # Game runtime engine
├── export/        # HTML/JS game export
├── ai/            # AI feature integrations
├── audio/         # Sound effect generation
├── import/        # External asset importers
├── styles/        # CSS themes
└── __tests__/     # Unit and integration tests
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a detailed architecture overview.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 |
| Language | TypeScript |
| Build | Vite |
| Canvas | Raw Canvas 2D API |
| Testing | Vitest + Playwright |
| Audio | Web Audio API |
| Persistence | IndexedDB |
| AI | OpenAI-compatible API |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `P` | Pencil / Paint |
| `E` | Eraser |
| `G` | Fill |
| `I` | Eyedropper |
| `B` | Tile Paint |
| `C` | Collision Tool |
| `Y` | Entity Tool |
| `Ctrl+S` | Save |
| `Ctrl+Z` | Undo |
| `?` | Shortcut Cheat Sheet |

Full reference: [docs/KEYBOARD-SHORTCUTS.md](docs/KEYBOARD-SHORTCUTS.md)

## License

MIT
