/**
 * SaveIndicator — shows the current save state: saving, saved, or error.
 */

import React from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SaveIndicatorProps {
  state: SaveState;
  projectName: string;
}

export const SaveIndicator: React.FC<SaveIndicatorProps> = ({ state, projectName }) => {
  const label = (() => {
    switch (state) {
      case 'saving':
        return 'Saving…';
      case 'saved':
        return 'Saved';
      case 'error':
        return 'Save failed!';
      default:
        return '';
    }
  })();

  return (
    <div className={`save-indicator save-indicator--${state}`} title={`${projectName} — ${label || 'No changes'}`}>
      <span className="save-indicator-name">{projectName}</span>
      {label && (
        <>
          <span className="save-indicator-dot" />
          <span className="save-indicator-label">{label}</span>
        </>
      )}
    </div>
  );
};
