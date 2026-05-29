/**
 * PlayControls — Play, Stop, and Restart buttons for the game runtime.
 *
 * Rendered above the canvas viewport when in tilemap mode.
 */

import React from 'react';

interface PlayControlsProps {
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onRestart: () => void;
}

export const PlayControls: React.FC<PlayControlsProps> = ({
  isPlaying,
  onPlay,
  onStop,
  onRestart,
}) => {
  if (!isPlaying) {
    return (
      <div className="play-controls">
        <button
          className="play-btn play-btn-primary"
          onClick={onPlay}
          title="Play the game (P)"
        >
          ▶ Play
        </button>
      </div>
    );
  }

  return (
    <div className="play-controls">
      <button
        className="play-btn play-btn-danger"
        onClick={onStop}
        title="Stop and return to editor"
      >
        ⏹ Stop
      </button>
      <button
        className="play-btn"
        onClick={onRestart}
        title="Restart from beginning"
      >
        🔄 Restart
      </button>
      <span className="play-controls-hint">
        Arrow keys / WASD to move
      </span>
    </div>
  );
};
