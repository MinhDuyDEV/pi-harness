/**
 * Memory extension — minimal, file-based, pi-shaped.
 *
 * After the brutal redesign: this is the entire LLM-facing memory surface.
 * No SQLite, no FTS5, no observation types, no feedback scores, no
 * custom tools. Just one before_agent_start hook that injects a markdown
 * file into the system prompt.
 *
 * The LLM sees:
 *   - ~/.pi/MEMORY.md          (global personal memory)
 *   - <project>/.pi/MEMORY.md  (project-level memory, if present)
 *
 * Both files are read on every agent turn. The LLM uses the built-in
 * read / write / edit / bash / grep primitives to manage them.
 *
 * To add a memory:    edit ~/.pi/MEMORY.md  (or tell the LLM)
 * To search memories:  bash grep "X" ~/.pi/MEMORY.md
 * To read a section:   read ~/.pi/MEMORY.md (offset/limit)
 * To compact:          rewrite the file, dropping low-value entries
 *
 * Per Mario (pi author): "If I don't need it, it won't be built. And I
 * don't need a lot of things." State is just files.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const GLOBAL_MEMORY = join(homedir(), ".pi", "MEMORY.md");

async function readIfExists(path: string): Promise<string | null> {
    try {
        const content = await readFile(path, "utf-8");
        return content.trim() ? content : null;
    } catch {
        return null;
    }
}

export default function (pi: ExtensionAPI) {
    pi.on("before_agent_start", async (event, ctx) => {
        const sections: string[] = [];
        const global = await readIfExists(GLOBAL_MEMORY);
        if (global) sections.push(`## ~/.pi/MEMORY.md\n\n${global}`);
        const project = await readIfExists(join(ctx.cwd, ".pi", "MEMORY.md"));
        if (project) sections.push(`## ${ctx.cwd}/.pi/MEMORY.md\n\n${project}`);
        if (sections.length === 0) return {};
        return { systemPrompt: event.systemPrompt + "\n\n" + sections.join("\n\n") };
    });
}
