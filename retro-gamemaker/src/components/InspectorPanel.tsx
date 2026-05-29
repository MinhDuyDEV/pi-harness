import React from 'react';

export interface InspectorProps {
  /** Currently selected tool id (for context) */
  activeTool?: string;
  /** Current zoom level (1 = 100%) */
  zoom?: number;
  /** Camera position in world coords */
  cameraX?: number;
  cameraY?: number;
}

export const InspectorPanel: React.FC<InspectorProps> = ({
  activeTool = 'pencil',
  zoom = 1,
  cameraX = 0,
  cameraY = 0,
}) => {
  return (
    <div className="inspector-panel" role="complementary" aria-label="Inspector">
      <div className="inspector-panel-header">Inspector</div>
      <div className="inspector-panel-body">
        {/* Tool info section */}
        <div className="inspector-section">
          <div className="inspector-section-title">Tool</div>
          <div className="inspector-field">
            <label>Active</label>
            <span style={{ color: 'var(--color-text-primary)' }}>
              {activeTool.charAt(0).toUpperCase() + activeTool.slice(1)}
            </span>
          </div>
        </div>

        {/* Canvas info section */}
        <div className="inspector-section">
          <div className="inspector-section-title">Viewport</div>
          <div className="inspector-field">
            <label>Zoom</label>
            <input type="text" value={`${Math.round(zoom * 100)}%`} readOnly />
          </div>
          <div className="inspector-field">
            <label>Pan X</label>
            <input type="text" value={cameraX.toFixed(1)} readOnly />
          </div>
          <div className="inspector-field">
            <label>Pan Y</label>
            <input type="text" value={cameraY.toFixed(1)} readOnly />
          </div>
        </div>

        {/* Placeholder for future sections */}
        <div className="inspector-section">
          <div className="inspector-section-title">Properties</div>
          <div className="inspector-empty">
            <div className="inspector-empty-icon">◌</div>
            <span>Select a tile or sprite to inspect</span>
          </div>
        </div>
      </div>
    </div>
  );
};
