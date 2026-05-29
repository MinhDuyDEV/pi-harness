/**
 * ExportDialog — modal for exporting the game as a standalone HTML file.
 *
 * Shows export results, file size, and optimization suggestions.
 */

import React, { useState, useCallback } from 'react';
import { Sprite } from '../core/Sprite';
import { Palette } from '../core/Palette';
import { Tilemap } from '../core/Tilemap';
import { Entity } from '../core/Entity';
import { EntityType } from '../core/EntityType';
import { ExportEngine, ExportResult, OptimizationSuggestion } from '../export/ExportEngine';

interface ExportDialogProps {
  open: boolean;
  projectName: string;
  sprites: Sprite[];
  palette: Palette;
  tilemap: Tilemap;
  entities: Entity[];
  entityTypes: EntityType[];
  onClose: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  projectName,
  sprites,
  palette,
  tilemap,
  entities,
  entityTypes,
  onClose,
}) => {
  const [result, setResult] = useState<ExportResult | null>(null);
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [analyzing, setAnalyzing] = useState(false);

  const handleExport = useCallback(() => {
    const exportResult = ExportEngine.export(
      projectName,
      sprites,
      palette,
      tilemap,
      entities,
      entityTypes,
    );
    setResult(exportResult);
    ExportEngine.download(exportResult.html, projectName);
  }, [projectName, sprites, palette, tilemap, entities, entityTypes]);

  const handleAnalyze = useCallback(() => {
    setAnalyzing(true);
    // Mock AI analysis with a short delay
    setTimeout(() => {
      const s = ExportEngine.analyze(sprites, tilemap, entities);
      setSuggestions(s);
      setAnalyzing(false);
    }, 500);
  }, [sprites, tilemap, entities]);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="dialog-title">Export Game</h2>

        {!result && (
          <div className="export-actions">
            <p className="dialog-message">
              Generate a single, self-contained HTML file that runs in any modern browser.
              No server or internet connection required.
            </p>

            <div className="export-btn-row">
              <button className="dialog-btn dialog-btn-primary" onClick={handleExport}>
                📤 Export Game HTML
              </button>
              <button
                className="dialog-btn"
                onClick={handleAnalyze}
                disabled={analyzing}
              >
                {analyzing ? 'Analyzing…' : '✨ Optimize Export'}
              </button>
            </div>

            {suggestions.length > 0 && (
              <div className="export-suggestions">
                <div className="export-suggestions-title">Analysis Results</div>
                {suggestions.map((s, i) => (
                  <div key={i} className={`export-suggestion export-suggestion--${s.type}`}>
                    <span className="export-suggestion-icon">
                      {s.type === 'success' ? '✅' : s.type === 'warning' ? '⚠️' : 'ℹ️'}
                    </span>
                    <span className="export-suggestion-text">{s.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="export-result">
            <p className="export-result-success">✅ Game exported successfully!</p>

            <div className="export-result-stats">
              <div className="export-stat">
                <span className="export-stat-label">File size</span>
                <span className="export-stat-value">{formatSize(result.sizeBytes)}</span>
              </div>
              <div className="export-stat">
                <span className="export-stat-label">Data size</span>
                <span className="export-stat-value">{formatSize(result.packedDataSize)}</span>
              </div>
              <div className="export-stat">
                <span className="export-stat-label">Sprites</span>
                <span className="export-stat-value">{result.spriteCount}</span>
              </div>
              <div className="export-stat">
                <span className="export-stat-label">Map tiles</span>
                <span className="export-stat-value">{result.tileCount.toLocaleString()}</span>
              </div>
              <div className="export-stat">
                <span className="export-stat-label">Entities</span>
                <span className="export-stat-value">{result.entityCount}</span>
              </div>
            </div>

            <div className="dialog-actions">
              <button className="dialog-btn dialog-btn-primary" onClick={handleExport}>
                Export Again
              </button>
              <button className="dialog-btn" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}

        {!result && (
          <div className="dialog-actions">
            <button className="dialog-btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
