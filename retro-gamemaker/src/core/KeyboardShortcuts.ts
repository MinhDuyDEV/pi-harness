/**
 * KeyboardShortcuts — central registry of all keyboard shortcuts.
 *
 * Each shortcut has a key, description, and optional category.
 * Used for tooltips, the cheat sheet, and global key handling.
 */

export interface ShortcutDef {
  /** Key combo, e.g. "Ctrl+Z", "P", "?" */
  keys: string;
  /** Description shown in tooltips and the cheat sheet */
  description: string;
  /** Category for grouping in cheat sheet */
  category: ShortcutCategory;
  /** Platform-specific label (Mac vs PC). If omitted, `keys` is used. */
  macKeys?: string;
}

export type ShortcutCategory =
  | 'Tools'
  | 'File'
  | 'Edit'
  | 'View'
  | 'Entity'
  | 'General';

export const SHORTCUTS: ShortcutDef[] = [
  // ── Tools ──
  { keys: 'P', description: 'Pencil / Paint tool', category: 'Tools' },
  { keys: 'E', description: 'Eraser tool', category: 'Tools' },
  { keys: 'G', description: 'Fill tool', category: 'Tools' },
  { keys: 'I', description: 'Eyedropper / Color picker', category: 'Tools' },
  { keys: 'B', description: 'Tile paint tool', category: 'Tools' },
  { keys: 'C', description: 'Collision tool', category: 'Tools' },
  { keys: 'Y', description: 'Entity tool', category: 'Tools' },

  // ── File ──
  { keys: 'Ctrl+S', description: 'Save project', category: 'File', macKeys: '⌘S' },
  { keys: 'Ctrl+O', description: 'Open project', category: 'File', macKeys: '⌘O' },
  { keys: 'Ctrl+N', description: 'New project', category: 'File', macKeys: '⌘N' },

  // ── Edit ──
  { keys: 'Ctrl+Z', description: 'Undo', category: 'Edit', macKeys: '⌘Z' },
  { keys: 'Ctrl+Shift+Z', description: 'Redo', category: 'Edit', macKeys: '⌘⇧Z' },
  { keys: 'Delete', description: 'Delete selected entity', category: 'Edit' },
  { keys: 'Ctrl+D', description: 'Duplicate entity', category: 'Edit', macKeys: '⌘D' },

  // ── View ──
  { keys: '?', description: 'Toggle shortcut cheat sheet', category: 'View' },
  { keys: 'Space', description: 'Pan (hold + drag)', category: 'View' },
  { keys: '+ / -', description: 'Zoom in / out', category: 'View' },
  { keys: 'Ctrl+\\', description: 'Toggle light/dark theme', category: 'View', macKeys: '⌘\\' },

  // ── Entity ──
  { keys: 'Enter', description: 'Start game (play mode)', category: 'General' },
  { keys: 'Escape', description: 'Stop game / close dialog', category: 'General' },

  // ── Sprite editor ──
  { keys: '1-4', description: 'Set zoom level (1×–4×)', category: 'View' },
];

/** Get shortcuts grouped by category. */
export function getShortcutsByCategory(): Map<ShortcutCategory, ShortcutDef[]> {
  const map = new Map<ShortcutCategory, ShortcutDef[]>();
  for (const s of SHORTCUTS) {
    const list = map.get(s.category) ?? [];
    list.push(s);
    map.set(s.category, list);
  }
  return map;
}

/** Format shortcut keys for display (Mac-friendly). */
export function formatShortcut(shortcut: ShortcutDef): string {
  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');
  return isMac && shortcut.macKeys ? shortcut.macKeys : shortcut.keys;
}
