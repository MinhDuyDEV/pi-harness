/**
 * PromptHistory — stores recent AI prompts in localStorage for re-use.
 */

export type GenerationType = 'sprite' | 'level' | 'entities' | 'behavior';

export interface PromptEntry {
  prompt: string;
  type: GenerationType;
  timestamp: number;
  /** Optional result summary (e.g., "Generated 16×16 sprite") */
  summary?: string;
}

const STORAGE_KEY = 'retro-gamemaker-prompt-history';
const MAX_ITEMS = 10;

export class PromptHistory {
  /** Get all stored prompts, most recent first. */
  static get(): PromptEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const entries = JSON.parse(raw) as PromptEntry[];
      return entries.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /** Add a new prompt entry. Trims to MAX_ITEMS. */
  static add(entry: Omit<PromptEntry, 'timestamp'>): void {
    const entries = PromptHistory.get();
    entries.unshift({
      ...entry,
      timestamp: Date.now(),
    });
    // Trim
    if (entries.length > MAX_ITEMS) {
      entries.length = MAX_ITEMS;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  /** Get prompts filtered by type. */
  static getByType(type: GenerationType): PromptEntry[] {
    return PromptHistory.get().filter((e) => e.type === type);
  }

  /** Clear all history. */
  static clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}
