/**
 * SoundEditor — waveform editor for 8-bit chiptune sound effects.
 *
 * Allows editing: waveform type, frequency, ADSR envelope, duty cycle.
 * Provides preview playback and behavior assignment.
 */

import React, { useState, useCallback, useRef } from 'react';
import { SoundEffect, WaveformType, ADSR } from '../audio/SoundEffect';
import { WaveformGenerator } from '../audio/WaveformGenerator';
import { EnvelopeEditor } from '../audio/EnvelopeEditor';
import { AudioManager, BehaviorSoundMapping } from '../audio/AudioManager';

interface SoundEditorProps {
  sound: SoundEffect;
  audioManager: AudioManager;
  onSoundChange: (sound: SoundEffect) => void;
  onClose: () => void;
}

const WAVEFORM_OPTIONS: WaveformType[] = ['square', 'triangle', 'sawtooth', 'noise'];
const WAVEFORM_LABELS: Record<WaveformType, string> = {
  square: 'Square',
  triangle: 'Triangle',
  sawtooth: 'Sawtooth',
  noise: 'Noise',
};

const BEHAVIOR_OPTIONS: BehaviorSoundMapping[] = ['collect', 'jump', 'hit', 'death', 'powerup', 'trigger'];

export const SoundEditor: React.FC<SoundEditorProps> = ({
  sound,
  audioManager,
  onSoundChange,
  onClose,
}) => {
  const [params, setParams] = useState({ ...sound.params });
  const [playing, setPlaying] = useState(false);
  const previewAudioRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const updateParam = useCallback(
    <K extends keyof typeof params>(key: K, value: (typeof params)[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateEnvelope = useCallback(
    <K extends keyof ADSR>(key: K, value: number) => {
      setParams((prev) => ({
        ...prev,
        envelope: { ...prev.envelope, [key]: value },
      }));
    },
    [],
  );

  const handlePlay = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const tempSfx = new SoundEffect(sound.id, sound.name, params);
      const generated = WaveformGenerator.generate(
        tempSfx.params.waveform,
        tempSfx.params.frequency,
        tempSfx.params.frequencyEnd,
        tempSfx.params.duration,
        tempSfx.params.volume,
        tempSfx.params.envelope,
        ctx.sampleRate,
        tempSfx.params.dutyCycle,
      );
      const buffer = WaveformGenerator.toAudioBuffer(ctx, generated);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      source.onended = () => setPlaying(false);
      previewAudioRef.current = source;
      setPlaying(true);
    } catch (err) {
      console.error('Playback failed:', err);
    }
  }, [sound, params]);

  const handleStop = useCallback(() => {
    previewAudioRef.current?.stop();
    setPlaying(false);
  }, []);

  const handleSave = useCallback(() => {
    const updated = new SoundEffect(sound.id, sound.name, params);
    onSoundChange(updated);
    onClose();
  }, [sound, params, onSoundChange, onClose]);

  // Envelope curve for visual preview
  const envelopeCurve = EnvelopeEditor.generateCurve(
    params.envelope,
    params.duration,
    80,
  );

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="dialog-title">Sound Editor: {sound.name}</h2>

        <div className="sound-editor-layout">
          {/* Waveform selector */}
          <div className="sound-editor-section">
            <label className="sound-editor-label">Waveform</label>
            <div className="sound-editor-waveforms">
              {WAVEFORM_OPTIONS.map((w) => (
                <button
                  key={w}
                  className={`sound-waveform-btn ${params.waveform === w ? 'active' : ''}`}
                  onClick={() => updateParam('waveform', w)}
                >
                  {WAVEFORM_LABELS[w]}
                </button>
              ))}
            </div>
          </div>

          {/* Frequency */}
          <div className="sound-editor-section">
            <label className="sound-editor-label">
              Frequency: {params.frequency} Hz
            </label>
            <input
              type="range"
              className="sound-editor-slider"
              min={40} max={4000}
              value={params.frequency}
              onChange={(e) => updateParam('frequency', Number(e.target.value))}
            />
          </div>

          {/* Frequency End (sweep) */}
          <div className="sound-editor-section">
            <label className="sound-editor-label">
              End Frequency: {params.frequencyEnd ?? params.frequency} Hz
              <button
                className="sound-editor-toggle-btn"
                onClick={() => updateParam('frequencyEnd', params.frequencyEnd ? undefined : params.frequency * 2)}
              >
                {params.frequencyEnd ? 'Clear' : 'Sweep'}
              </button>
            </label>
            {params.frequencyEnd !== undefined && (
              <input
                type="range"
                className="sound-editor-slider"
                min={20} max={8000}
                value={params.frequencyEnd}
                onChange={(e) => updateParam('frequencyEnd', Number(e.target.value))}
              />
            )}
          </div>

          {/* Duration */}
          <div className="sound-editor-section">
            <label className="sound-editor-label">
              Duration: {params.duration.toFixed(2)}s
            </label>
            <input
              type="range"
              className="sound-editor-slider"
              min={0.05} max={2}
              step={0.01}
              value={params.duration}
              onChange={(e) => updateParam('duration', parseFloat(e.target.value))}
            />
          </div>

          {/* Volume */}
          <div className="sound-editor-section">
            <label className="sound-editor-label">
              Volume: {Math.round(params.volume * 100)}%
            </label>
            <input
              type="range"
              className="sound-editor-slider"
              min={0} max={1}
              step={0.05}
              value={params.volume}
              onChange={(e) => updateParam('volume', parseFloat(e.target.value))}
            />
          </div>

          {/* Duty Cycle (square wave only) */}
          {params.waveform === 'square' && (
            <div className="sound-editor-section">
              <label className="sound-editor-label">
                Duty Cycle: {params.dutyCycle?.toFixed(2)}
              </label>
              <input
                type="range"
                className="sound-editor-slider"
                min={0.05} max={0.95}
                step={0.05}
                value={params.dutyCycle ?? 0.5}
                onChange={(e) => updateParam('dutyCycle', parseFloat(e.target.value))}
              />
            </div>
          )}

          {/* ADSR Envelope */}
          <div className="sound-editor-section sound-editor-adsr">
            <label className="sound-editor-label">Envelope (ADSR)</label>

            {/* Visual envelope curve */}
            <div className="envelope-visual">
              <svg viewBox="0 0 100 40" className="envelope-svg">
                <rect width="100" height="40" fill="#0d1117" rx="2" />
                <polyline
                  points={envelopeCurve
                    .map((v, i) => `${(i / (envelopeCurve.length - 1)) * 100},${40 - v * 38}`)
                    .join(' ')}
                  fill="none"
                  stroke="#58a6ff"
                  strokeWidth="1.5"
                />
              </svg>
            </div>

            <div className="envelope-sliders">
              <div className="envelope-slider-group">
                <label>A</label>
                <input
                  type="range"
                  min={0.001} max={1} step={0.001}
                  value={params.envelope.attack}
                  onChange={(e) => updateEnvelope('attack', parseFloat(e.target.value))}
                />
                <span className="envelope-value">{params.envelope.attack.toFixed(3)}s</span>
              </div>
              <div className="envelope-slider-group">
                <label>D</label>
                <input
                  type="range"
                  min={0.001} max={1} step={0.001}
                  value={params.envelope.decay}
                  onChange={(e) => updateEnvelope('decay', parseFloat(e.target.value))}
                />
                <span className="envelope-value">{params.envelope.decay.toFixed(3)}s</span>
              </div>
              <div className="envelope-slider-group">
                <label>S</label>
                <input
                  type="range"
                  min={0} max={1} step={0.01}
                  value={params.envelope.sustain}
                  onChange={(e) => updateEnvelope('sustain', parseFloat(e.target.value))}
                />
                <span className="envelope-value">{params.envelope.sustain.toFixed(2)}</span>
              </div>
              <div className="envelope-slider-group">
                <label>R</label>
                <input
                  type="range"
                  min={0.001} max={3} step={0.001}
                  value={params.envelope.release}
                  onChange={(e) => updateEnvelope('release', parseFloat(e.target.value))}
                />
                <span className="envelope-value">{params.envelope.release.toFixed(3)}s</span>
              </div>
            </div>
          </div>

          {/* Behavior assignment */}
          <div className="sound-editor-section">
            <label className="sound-editor-label">Assign to Behavior</label>
            <div className="behavior-assignments">
              {BEHAVIOR_OPTIONS.map((b) => {
                const assigned = audioManager.getBehaviorSound(b);
                return (
                  <label key={b} className="behavior-assign-row">
                    <input
                      type="checkbox"
                      checked={assigned === sound.id}
                      onChange={() => {
                        if (assigned === sound.id) {
                          audioManager.assignBehavior(b, '');
                        } else {
                          audioManager.assignBehavior(b, sound.id);
                        }
                      }}
                    />
                    <span className="behavior-assign-label">
                      {b.charAt(0).toUpperCase() + b.slice(1)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Playback controls */}
        <div className="sound-editor-playback">
          <button
            className={`sound-play-btn ${playing ? 'playing' : ''}`}
            onClick={playing ? handleStop : handlePlay}
          >
            {playing ? '⏹ Stop' : '▶ Preview'}
          </button>
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleSave}>
            Save Sound
          </button>
        </div>
      </div>
    </div>
  );
};
