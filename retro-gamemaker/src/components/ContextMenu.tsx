/**
 * ContextMenu — a right-click context menu component.
 *
 * Renders a positioned menu with items, separators, and optional
 * keyboard shortcut hints.
 */

import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

export type ContextMenuSeparator = { separator: true };

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Delay to avoid the same click that opened the menu
    setTimeout(() => {
      window.addEventListener('mousedown', handler);
      window.addEventListener('keydown', keyHandler);
    }, 0);
    return () => {
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  // Adjust position to keep menu on-screen
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 300);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: adjustedX, top: adjustedY }}
      role="menu"
    >
      {items.map((entry, i) => {
        if ('separator' in entry) {
          return <div key={i} className="context-menu-separator" />;
        }
        const item = entry as ContextMenuItem;
        return (
          <button
            key={item.id}
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            role="menuitem"
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <kbd className="context-menu-shortcut">{item.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
};
