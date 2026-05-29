/**
 * AIGenerationDialog — unified modal for all AI generation features.
 *
 * Supports: sprite, level, entities, behavior generation.
 * Handles prompt input, history, loading, errors, and results.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AIClient } from '../ai/AIClient';
import { PromptHistory, GenerationType, PromptEntry } from '../ai/PromptHistory';
import { SpriteGenerator } from '../ai/SpriteGenerator';
import { LevelGenerator, LevelGenResult } from '../ai/LevelGenerator';
import { EntitySuggester, EntitySuggesterResult } from '../ai/EntitySuggester';
import { BehaviorGenerator, BehaviorGenResult } from '../ai/BehaviorGenerator';
import { Sprite } from '../core/Sprite';
import { Palette } from '../core/Palette';
import { Tilemap } from '../core/Tilemap';

export type GenMode = GenerationType;

interface AIGenerationDialogProps {
  open: boolean;
  mode: GenMode;
  onClose: () => void;
  /** Called when a sprite is generated */
  onSpriteGenerated?: (sprite: Sprite, description: string) => void;
  /** Called when level tiles are generated */
  onLevelGenerated?: (result: LevelGenResult) => void;
  /** Called when entity suggestions are generated */
  onEntitiesGenerated?: (result: EntitySuggesterResult) => void;
  /** Called when a behavior script is generated */
  onBehaviorGenerated?: (result: BehaviorGenResult) => void;
  /** Context for level generation */
  levelContext?: {
    tilemap: Tilemap;
    tileLabels: string[];
    entityTypes: Array<{ id: string; name: string }>;
    entitySummary: string;
  };
  /** Context for sprite generation */
  spriteContext?: {
    width: number;
    height: number;
    palette: Palette;
  };
}

export const AIGenerationDialog: React.FC<AIGenerationDialogProps> = ({
  open,
  mode,
  onClose,
  onSpriteGenerated,
  onLevelGenerated,
  onEntitiesGenerated,
  onBehaviorGenerated,
  levelContext,
  spriteContext,
}) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [eta, setEta] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const etaTimerRef = useRef<number | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const history = PromptHistory.getByType(mode);

  // Focus prompt when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => promptRef.current?.focus(), 100);
      setError(null);
      setResult(null);
    }
  }, [open, mode]);

  // Estimate time based on mode
  const estimateTime = useCallback(() => {
    const times: Record<GenMode, { min: number; max: number }> = {
      sprite: { min: 5, max: 15 },
      level: { min: 10, max: 25 },
      entities: { min: 8, max: 20 },
      behavior: { min: 5, max: 12 },
    };
    const t = times[mode] ?? { min: 5, max: 15 };
    return `Est. ${t.min}–${t.max}s`;
  }, [mode]);

  // Update ETA during generation
  useEffect(() => {
    if (loading) {
      const update = () => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setEta(`Running… ${elapsed.toFixed(0)}s`);
        etaTimerRef.current = window.setTimeout(update, 1000);
      };
      update();
    } else {
      if (etaTimerRef.current) {
        clearTimeout(etaTimerRef.current);
        etaTimerRef.current = null;
      }
      setEta(null);
    }
    return () => {
      if (etaTimerRef.current) clearTimeout(etaTimerRef.current);
    };
  }, [loading]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    startTimeRef.current = Date.now();

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // Check API configuration
      if (!AIClient.isConfigured()) {
        throw new Error('API key not configured. Go to AI Settings to set your key.');
      }

      switch (mode) {
        case 'sprite': {
          const ctx = spriteContext;
          if (!ctx || !onSpriteGenerated) {
            throw new Error('Sprite generation context not available');
          }
          const genResult = await SpriteGenerator.generate(
            prompt,
            ctx.width,
            ctx.height,
            ctx.palette.colours,
            abortController.signal,
          );
          // Convert 2D pixel array to flat Uint8Array
          const flatPixels = new Uint8Array(ctx.width * ctx.height);
          for (let y = 0; y < genResult.pixels.length; y++) {
            for (let x = 0; x < genResult.pixels[y].length; x++) {
              flatPixels[y * ctx.width + x] = genResult.pixels[y][x];
            }
          }
          const sprite = new Sprite(ctx.width, ctx.height, flatPixels);
          onSpriteGenerated(sprite, genResult.description ?? '');
          setResult(`Generated ${ctx.width}×${ctx.height} sprite.`);
          PromptHistory.add({ prompt, type: mode, summary: `${ctx.width}×${ctx.height} sprite` });
          break;
        }

        case 'level': {
          const ctx = levelContext;
          if (!ctx || !onLevelGenerated) {
            throw new Error('Level generation context not available');
          }
          const genResult = await LevelGenerator.generate(
            prompt,
            ctx.tilemap.width,
            ctx.tilemap.height,
            ctx.tilemap.layers.length,
            ctx.tileLabels,
            abortController.signal,
          );
          onLevelGenerated(genResult);
          setResult(`Generated ${ctx.tilemap.width}×${ctx.tilemap.height} level.`);
          PromptHistory.add({ prompt, type: mode, summary: 'Level generated' });
          break;
        }

        case 'entities': {
          const ctx = levelContext;
          if (!ctx || !onEntitiesGenerated) {
            throw new Error('Entity suggestion context not available');
          }
          const genResult = await EntitySuggester.suggest(
            prompt,
            ctx.tilemap.width,
            ctx.tilemap.height,
            ctx.tilemap.tileSize,
            ctx.tileLabels,
            ctx.entityTypes,
            ctx.entitySummary,
            abortController.signal,
          );
          onEntitiesGenerated(genResult);
          setResult(`Suggested ${genResult.entities.length} entities.`);
          PromptHistory.add({ prompt, type: mode, summary: `${genResult.entities.length} entities suggested` });
          break;
        }

        case 'behavior': {
          if (!onBehaviorGenerated) {
            throw new Error('Behavior generation context not available');
          }
          const genResult = await BehaviorGenerator.generate(
            prompt,
            abortController.signal,
          );
          onBehaviorGenerated(genResult);
          setResult(`Generated behavior: ${genResult.name}`);
          PromptHistory.add({ prompt, type: mode, summary: genResult.name });
          break;
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Generation cancelled.');
      } else {
        setError(err.message || 'An error occurred during generation.');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [prompt, loading, mode, spriteContext, levelContext, onSpriteGenerated, onLevelGenerated, onEntitiesGenerated, onBehaviorGenerated]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const handleRetry = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  const handleHistorySelect = useCallback((entry: PromptEntry) => {
    setPrompt(entry.prompt);
    setShowHistory(false);
  }, []);

  const modeLabel: Record<GenMode, string> = {
    sprite: 'Generate Sprite',
    level: 'Generate Level',
    entities: 'Suggest Entities',
    behavior: 'Generate Behavior',
  };

  const modePlaceholder: Record<GenMode, string> = {
    sprite: 'Describe the sprite you want (e.g. "a red mushroom with white spots")',
    level: 'Describe the level (e.g. "a grassy field with a river through the middle")',
    entities: 'Describe the gameplay (e.g. "challenging platformer with enemies and coins")',
    behavior: 'Describe the behavior (e.g. "enemy that chases the player when nearby")',
  };

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="dialog-title">AI: {modeLabel[mode]}</h2>

        {/* Prompt input */}
        <div className="ai-gen-field">
          <label className="ai-gen-label" htmlFor="ai-prompt">Your prompt</label>
          <textarea
            id="ai-prompt"
            ref={promptRef}
            className="ai-gen-textarea"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={modePlaceholder[mode]}
            disabled={loading}
          />
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="ai-gen-history">
            <button
              className="ai-gen-history-toggle"
              onClick={() => setShowHistory(!showHistory)}
            >
              Prompt history ({history.length})
            </button>
            {showHistory && (
              <div className="ai-gen-history-list">
                {history.map((entry, i) => (
                  <button
                    key={i}
                    className="ai-gen-history-item"
                    onClick={() => handleHistorySelect(entry)}
                  >
                    <span className="ai-gen-history-prompt">{entry.prompt}</span>
                    {entry.summary && (
                      <span className="ai-gen-history-summary">{entry.summary}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ETA */}
        {!loading && !error && (
          <div className="ai-gen-eta">{estimateTime()}</div>
        )}

        {/* Loading */}
        {loading && (
          <div className="ai-gen-loading">
            <div className="ai-gen-spinner" />
            <span>{eta || 'Generating…'}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="ai-gen-error">
            <span className="ai-gen-error-icon">⚠️</span>
            <span className="ai-gen-error-text">{error}</span>
            <button className="ai-gen-retry-btn" onClick={handleRetry}>
              Retry
            </button>
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="ai-gen-result">
            <span className="ai-gen-result-icon">✅</span>
            <span>{result}</span>
          </div>
        )}

        {/* Actions */}
        <div className="dialog-actions">
          {loading ? (
            <button className="dialog-btn dialog-btn-danger" onClick={handleCancel}>
              Cancel
            </button>
          ) : (
            <>
              <button className="dialog-btn" onClick={onClose}>Close</button>
              <button
                className="dialog-btn dialog-btn-primary"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
              >
                Generate
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
