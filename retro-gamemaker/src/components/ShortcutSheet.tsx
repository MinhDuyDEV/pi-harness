/**
 * ShortcutSheet — modal listing all keyboard shortcuts grouped by category.
 * Toggle with `?` key.
 */

import React from 'react';
import { getShortcutsByCategory, formatShortcut, ShortcutCategory } from '../core/KeyboardShortcuts';

const CATEGORY_ORDER: ShortcutCategory[] = ['File', 'Edit', 'Tools', 'Entity', 'View', 'General'];

interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
}

export const ShortcutSheet: React.FC<ShortcutSheetProps> = ({ open, onClose }) => {
  if (!open) return null;

  const grouped = getShortcutsByCategory();

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-wide shortcuts-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">Keyboard Shortcuts</h2>

        <div className="shortcuts-grid">
          {CATEGORY_ORDER.map(
            (cat) =>
              grouped.has(cat) && (
                <div key={cat} className="shortcuts-group">
                  <h3 className="shortcuts-category">{cat}</h3>
                  <div className="shortcuts-list">
                    {grouped.get(cat)!.map((s, i) => (
                      <div key={i} className="shortcuts-row">
                        <kbd className="shortcuts-key">{formatShortcut(s)}</kbd>
                        <span className="shortcuts-desc">{s.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ),
          )}
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
