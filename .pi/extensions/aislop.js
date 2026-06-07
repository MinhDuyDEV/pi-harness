// aislop — auto-generated pi extension. Do not edit by hand.
// Reinstall with: aislop hook install --pi
import { spawnSync } from "node:child_process";

export default function (pi) {
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		if (event.isError) return;
		const filePath = event.input && event.input.path;
		if (typeof filePath !== "string" || filePath.length === 0) return;

		const bin = process.env.AISLOP_BIN || "aislop";
		const payload = JSON.stringify({
			cwd: ctx.cwd,
			file_path: filePath,
			tool_name: event.toolName,
		});

		let out;
		try {
			const res = spawnSync(bin, ["hook", "pi"], {
				input: payload,
				encoding: "utf-8",
				timeout: 15000,
			});
			if (res.status !== 0 || !res.stdout) return;
			out = JSON.parse(res.stdout);
		} catch {
			return;
		}
		if (!out || !out.message) return;

		return {
			content: [...event.content, { type: "text", text: out.message }],
			isError: event.isError,
		};
	});
}
