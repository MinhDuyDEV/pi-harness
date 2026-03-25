// <cwd>/.pi/tasks-config.json — persists extension settings across sessions
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const CONFIG_PATH = join(process.cwd(), ".pi", "tasks-config.json");
export function loadTasksConfig() {
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
    catch {
        return {};
    }
}
export function saveTasksConfig(config) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
