/**
 * settings-menu.ts — Polished settings panel for /tasks → Settings.
 *
 * Uses ui.custom() + SettingsList for native TUI rendering with keyboard
 * navigation, live toggle, and per-row descriptions — matching pi-coding-agent's
 * own settings panel style.
 */
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, SettingsList, Spacer, Text } from "@mariozechner/pi-tui";
import { saveTasksConfig } from "../tasks-config.js";
// ── Settings panel ──────────────────────────────────────────────────────────
export async function openSettingsMenu(ui, cfg, onBack, clearDelayTurns) {
    await ui.custom((_tui, theme, _kb, done) => {
        const items = [
            {
                id: "taskScope",
                label: "Task storage",
                description: "memory: tasks live only in memory, lost when session ends. " +
                    "session: persisted per session (tasks-<sessionId>.json), survives resume. " +
                    "project: shared across all sessions (tasks.json). " +
                    "Takes effect on next session start.",
                currentValue: cfg.taskScope ?? "session",
                values: ["memory", "session", "project"],
            },
            {
                id: "autoCascade",
                label: "Auto-execute with agents",
                description: "When ON: pending agent tasks start automatically once their dependencies complete. " +
                    "When OFF: use TaskExecute to launch them manually.",
                currentValue: (cfg.autoCascade ?? false) ? "on" : "off",
                values: ["on", "off"],
            },
            {
                id: "autoClearCompleted",
                label: "Auto-clear completed tasks",
                description: "never: completed tasks stay visible until manually cleared. " +
                    "on_list_complete: cleared automatically after all tasks are done. " +
                    "on_task_complete: each task cleared shortly after it completes. " +
                    `Clearing lags ~${clearDelayTurns} turns.`,
                currentValue: cfg.autoClearCompleted ?? "on_list_complete",
                values: ["never", "on_list_complete", "on_task_complete"],
            },
        ];
        const list = new SettingsList(items, 
        /* maxVisible */ 10, getSettingsListTheme(), 
        /* onChange */ (id, newValue) => {
            if (id === "autoCascade") {
                cfg.autoCascade = newValue === "on";
                saveTasksConfig(cfg);
            }
            if (id === "taskScope") {
                cfg.taskScope = newValue;
                saveTasksConfig(cfg);
            }
            if (id === "autoClearCompleted") {
                cfg.autoClearCompleted = newValue;
                saveTasksConfig(cfg);
            }
        }, 
        /* onCancel */ () => done(undefined));
        // Container doesn't forward handleInput to children — subclass to fix.
        class SettingsPanel extends Container {
            handleInput(data) { list.handleInput(data); }
        }
        const root = new SettingsPanel();
        root.addChild(new Text(theme.bold(theme.fg("accent", "⚙  Task Settings")), 0, 0));
        root.addChild(new Spacer(1));
        root.addChild(list);
        return root;
    });
    return onBack();
}
