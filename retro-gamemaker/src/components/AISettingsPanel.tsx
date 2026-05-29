/**
 * AISettingsPanel — API configuration for AI features.
 *
 * API key stored in localStorage. Model and temperature configurable.
 * Panel can be embedded in a dialog or sidebar.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { AIClient, AI_MODELS } from '../ai/AIClient';

interface AISettingsPanelProps {
  /** Called after settings change, so parent can react. */
  onSettingsChange?: () => void;
}

export const AISettingsPanel: React.FC<AISettingsPanelProps> = ({ onSettingsChange }) => {
  const [apiKey, setApiKey] = useState(AIClient.getAPIKey());
  const [model, setModel] = useState(AIClient.getModel());
  const [temperature, setTemperature] = useState(AIClient.getTemperature());
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(() => {
    AIClient.setAPIKey(apiKey);
    AIClient.setModel(model);
    AIClient.setTemperature(temperature);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSettingsChange?.();
  }, [apiKey, model, temperature, onSettingsChange]);

  useEffect(() => {
    // Sync if external changes
    setApiKey(AIClient.getAPIKey());
    setModel(AIClient.getModel());
    setTemperature(AIClient.getTemperature());
  }, []);

  return (
    <div className="ai-settings">
      <div className="ai-settings-header">AI Settings</div>

      <div className="ai-settings-field">
        <label className="ai-settings-label" htmlFor="ai-api-key">API Key</label>
        <div className="ai-settings-key-row">
          <input
            id="ai-api-key"
            className="ai-settings-input ai-settings-monospace"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
          <button
            className="ai-settings-toggle-btn"
            onClick={() => setShowKey(!showKey)}
            title={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      <div className="ai-settings-field">
        <label className="ai-settings-label" htmlFor="ai-model">Model</label>
        <select
          id="ai-model"
          className="ai-settings-select"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <div className="ai-settings-field">
        <label className="ai-settings-label" htmlFor="ai-temperature">
          Temperature: {temperature.toFixed(1)}
        </label>
        <input
          id="ai-temperature"
          type="range"
          className="ai-settings-slider"
          min={0}
          max={1.5}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(parseFloat(e.target.value))}
        />
        <div className="ai-settings-slider-labels">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>

      <button className="ai-settings-save-btn" onClick={handleSave}>
        {saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  );
};
