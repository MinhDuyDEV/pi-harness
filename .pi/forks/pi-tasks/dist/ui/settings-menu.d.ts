/**
 * settings-menu.ts — Polished settings panel for /tasks → Settings.
 *
 * Uses ui.custom() + SettingsList for native TUI rendering with keyboard
 * navigation, live toggle, and per-row descriptions — matching pi-coding-agent's
 * own settings panel style.
 */
import { type TasksConfig } from "../tasks-config.js";
export type SettingsUI = {
    custom<T>(factory: (tui: any, theme: any, keybindings: any, done: (result: T) => void) => any, options?: {
        overlay?: boolean;
        overlayOptions?: any;
    }): Promise<T>;
};
export declare function openSettingsMenu(ui: SettingsUI, cfg: TasksConfig, onBack: () => Promise<void>, clearDelayTurns: number): Promise<void>;
