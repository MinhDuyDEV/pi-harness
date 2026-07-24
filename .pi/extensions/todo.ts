import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import * as fs from "node:fs"
import * as path from "node:path"

const TOOL_CALL_THRESHOLD = 2
const TODO_STALE_MINUTES = 5

interface SessionState {
	toolCallCount: number
	reminderShown: boolean
}

const state: SessionState = {
	toolCallCount: 0,
	reminderShown: false,
}

function findCanonicalTodo(cwd: string): string | null {
	let dir = path.resolve(cwd)
	while (true) {
		const candidate = path.join(dir, ".pi", "artifacts", "TODO.md")
		if (fs.existsSync(candidate)) return candidate
		const parent = path.dirname(dir)
		if (parent === dir) return null
		dir = parent
	}
}

function checkTodoFile(cwd: string): { exists: boolean; fresh: boolean; ageMinutes: number } {
	const todoPath = findCanonicalTodo(cwd)
	if (!todoPath) {
		return { exists: false, fresh: false, ageMinutes: -1 }
	}
	const stats = fs.statSync(todoPath)
	const ageMs = Date.now() - stats.mtimeMs
	return {
		exists: true,
		fresh: ageMs < TODO_STALE_MINUTES * 60 * 1000,
		ageMinutes: ageMs / 60000,
	}
}

export default function (pi: ExtensionAPI) {
	// Reset state on each session (parent or subagent)
	pi.on("session_start", async () => {
		state.toolCallCount = 0
		state.reminderShown = false
	})

	// Track tool calls
	pi.on("tool_call", async () => {
		state.toolCallCount++
	})

	// Inject reminder on the first edit/write result after threshold
	pi.on("tool_result", async (event, ctx) => {
		if (state.reminderShown) return
		if (state.toolCallCount < TOOL_CALL_THRESHOLD) return
		if (event.toolName !== "edit" && event.toolName !== "write") return
		if (event.isError) return

		const todo = checkTodoFile(ctx.cwd)
		if (todo.exists && todo.fresh) return

		state.reminderShown = true

		const message = todo.exists
			? `[todo] Task has ${state.toolCallCount} tool calls. .pi/artifacts/TODO.md was last modified ${Math.round(todo.ageMinutes)}m ago. Per the TODO Tracking rule, append a ### block now.`
			: `[todo] Task has ${state.toolCallCount} tool calls but .pi/artifacts/TODO.md does not exist. Per the TODO Tracking rule, create it and append a ### block now.`

		ctx.ui.notify("TODO tracking rule: this task needs a TODO entry", "info")

		return {
			content: [...event.content, { type: "text", text: message }],
			isError: event.isError,
		}
	})
}
