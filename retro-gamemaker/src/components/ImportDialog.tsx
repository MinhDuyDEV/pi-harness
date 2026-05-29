/**
 * ImportDialog — modal for importing PNG spritesheets and Tiled .tmx files.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Sprite } from '../core/Sprite';
import { Palette } from '../core/Palette';
import { PNGImporter, ImportedSprite } from '../import/PNGImporter';
import { TiledImporter, TiledImportResult } from '../import/TiledImporter';

type ImportTab = 'png' | 'tmx';

interface ImportDialogProps {
  open: boolean;
  palette: Palette;
  onSpritesImported: (sprites: Sprite[], labels: string[]) => void;
  onTilemapImported: (result: TiledImportResult) => void;
  onClose: () => void;
}

export const ImportDialog: React.FC<ImportDialogProps> = ({
  open,
  palette,
  onSpritesImported,
  onTilemapImported,
  onClose,
}) => {
  const [tab, setTab] = useState<ImportTab>('png');

  // PNG state
  const [pngFile, setPngFile] = useState<File | null>(null);
  const [pngPreview, setPngPreview] = useState<string | null>(null);
  const [cellWidth, setCellWidth] = useState(16);
  const [cellHeight, setCellHeight] = useState(16);
  const [autoDetected, setAutoDetected] = useState(false);
  const [importedSprites, setImportedSprites] = useState<ImportedSprite[] | null>(null);
  const [pngLoading, setPngLoading] = useState(false);

  // TMX state
  const [tmxFile, setTmxFile] = useState<File | null>(null);
  const [tmxResult, setTmxResult] = useState<TiledImportResult | null>(null);
  const [tmxLoading, setTmxLoading] = useState(false);
  const [tmxError, setTmxError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (tab === 'png') {
      setPngFile(file);
      setImportedSprites(null);

      // Load preview
      const reader = new FileReader();
      reader.onload = () => setPngPreview(reader.result as string);
      reader.readAsDataURL(file);

      // Auto-detect
      try {
        const img = await PNGImporter.loadFile(file);
        const grid = PNGImporter.autoDetectGrid(img.width, img.height);
        if (grid) {
          setCellWidth(grid.cellWidth);
          setCellHeight(grid.cellHeight);
          setAutoDetected(true);
        }
      } catch {}
    } else {
      setTmxFile(file);
      setTmxResult(null);
      setTmxError(null);
    }
  }, [tab]);

  const handlePNGSplit = useCallback(async () => {
    if (!pngFile) return;
    setPngLoading(true);
    try {
      const img = await PNGImporter.loadFile(pngFile);
      const sprites = PNGImporter.splitGrid(img, cellWidth, cellHeight, palette.colours);
      setImportedSprites(sprites);
    } catch (err: any) {
      console.error('Failed to split spritesheet:', err);
    }
    setPngLoading(false);
  }, [pngFile, cellWidth, cellHeight, palette]);

  const handlePNGApply = useCallback(() => {
    if (!importedSprites) return;
    const sprites = importedSprites.map((is) => is.sprite);
    const labels = importedSprites.map(
      (is) => `Sprite ${is.col},${is.row}`,
    );
    onSpritesImported(sprites, labels);
    onClose();
  }, [importedSprites, onSpritesImported, onClose]);

  const handleTMXImport = useCallback(async () => {
    if (!tmxFile) return;
    setTmxLoading(true);
    setTmxError(null);
    try {
      const content = await tmxFile.text();
      const result = TiledImporter.parse(content);
      setTmxResult(result);
    } catch (err: any) {
      setTmxError(err.message || 'Failed to parse .tmx file.');
    }
    setTmxLoading(false);
  }, [tmxFile]);

  const handleTMXApply = useCallback(() => {
    if (!tmxResult) return;
    onTilemapImported(tmxResult);
    onClose();
  }, [tmxResult, onTilemapImported, onClose]);

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="dialog-title">Import Assets</h2>

        {/* Tabs */}
        <div className="import-tabs">
          <button
            className={`import-tab ${tab === 'png' ? 'active' : ''}`}
            onClick={() => setTab('png')}
          >
            PNG Spritesheet
          </button>
          <button
            className={`import-tab ${tab === 'tmx' ? 'active' : ''}`}
            onClick={() => setTab('tmx')}
          >
            Tiled Map (.tmx)
          </button>
        </div>

        {tab === 'png' && (
          <div className="import-panel">
            <input
              ref={fileInputRef}
              type="file"
              accept=".png"
              onChange={handleFileSelect}
              className="import-file-input"
            />

            {pngPreview && (
              <div className="import-preview-row">
                <div className="import-preview">
                  <img src={pngPreview} alt="Spritesheet preview" />
                </div>

                <div className="import-grid-settings">
                  <label className="import-label">
                    Cell width:
                    <input
                      type="number"
                      className="import-number-input"
                      min={4} max={128}
                      value={cellWidth}
                      onChange={(e) => { setCellWidth(Number(e.target.value)); setAutoDetected(false); }}
                    />
                  </label>
                  <label className="import-label">
                    Cell height:
                    <input
                      type="number"
                      className="import-number-input"
                      min={4} max={128}
                      value={cellHeight}
                      onChange={(e) => { setCellHeight(Number(e.target.value)); setAutoDetected(false); }}
                    />
                  </label>
                  {autoDetected && (
                    <span className="import-auto-badge">Auto-detected</span>
                  )}
                  <button
                    className="dialog-btn"
                    onClick={handlePNGSplit}
                    disabled={pngLoading}
                  >
                    {pngLoading ? 'Splitting…' : 'Preview Split'}
                  </button>
                </div>
              </div>
            )}

            {importedSprites && (
              <div className="import-sprite-grid">
                <div className="import-sprite-count">
                  {importedSprites.length} sprites ({cellWidth}×{cellHeight})
                </div>
                <div className="import-sprite-previews">
                  {importedSprites.slice(0, 20).map((is, i) => (
                    <div key={i} className="import-sprite-preview">
                      <canvas
                        ref={(el) => {
                          if (el) {
                            el.width = cellWidth;
                            el.height = cellHeight;
                            const ctx = el.getContext('2d')!;
                            ctx.putImageData(is.sprite.toImageData(palette.colours), 0, 0);
                          }
                        }}
                        width={cellWidth}
                        height={cellHeight}
                        style={{ width: 32, height: 32, imageRendering: 'pixelated' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="dialog-actions">
              <button className="dialog-btn" onClick={onClose}>Cancel</button>
              {importedSprites && (
                <button className="dialog-btn dialog-btn-primary" onClick={handlePNGApply}>
                  Add {importedSprites.length} Sprites
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'tmx' && (
          <div className="import-panel">
            <input
              type="file"
              accept=".tmx,.xml"
              onChange={handleFileSelect}
              className="import-file-input"
            />

            {tmxFile && !tmxResult && !tmxError && (
              <div className="import-ready">
                <p>Ready to import: {tmxFile.name}</p>
                <button
                  className="dialog-btn dialog-btn-primary"
                  onClick={handleTMXImport}
                  disabled={tmxLoading}
                >
                  {tmxLoading ? 'Parsing…' : 'Import Map'}
                </button>
              </div>
            )}

            {tmxResult && (
              <div className="import-result">
                <p className="import-result-success">✅ Map imported successfully!</p>
                <p>{tmxResult.tilemap.width}×{tmxResult.tilemap.height}, {tmxResult.tilemap.layers.length} layers</p>
                {tmxResult.warnings.length > 0 && (
                  <div className="import-warnings">
                    {tmxResult.warnings.map((w, i) => (
                      <p key={i} className="import-warning">⚠️ {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tmxError && (
              <div className="import-error">
                <p>❌ {tmxError}</p>
              </div>
            )}

            <div className="dialog-actions">
              <button className="dialog-btn" onClick={onClose}>Cancel</button>
              {tmxResult && (
                <button className="dialog-btn dialog-btn-primary" onClick={handleTMXApply}>
                  Apply Map
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
