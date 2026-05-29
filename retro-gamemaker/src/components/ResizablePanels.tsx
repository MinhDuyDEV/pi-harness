/**
 * ResizablePanels — a horizontal split pane with a draggable resize handle.
 *
 * Used to make the canvas/panel boundaries user-adjustable.
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';

interface ResizablePanelsProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Initial left panel width in pixels */
  defaultLeftWidth?: number;
  /** Minimum left panel width */
  minLeft?: number;
  /** Maximum left panel width */
  maxLeft?: number;
  /** CSS class for the container */
  className?: string;
}

export const ResizablePanels: React.FC<ResizablePanelsProps> = ({
  left,
  right,
  defaultLeftWidth = 280,
  minLeft = 180,
  maxLeft = 500,
  className = '',
}) => {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const newWidth = e.clientX - rect.left;
    setLeftWidth(Math.max(minLeft, Math.min(maxLeft, newWidth)));
  }, [minLeft, maxLeft]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    if (isDragging.current) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div ref={containerRef} className={`resizable-panels ${className}`}>
      <div className="resizable-left" style={{ width: leftWidth }}>
        {left}
      </div>
      <div className="resizable-handle" onMouseDown={handleMouseDown} />
      <div className="resizable-right">
        {right}
      </div>
    </div>
  );
};
