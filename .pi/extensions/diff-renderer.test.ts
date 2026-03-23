import { strict as assert } from "node:assert";
import { test } from "node:test";

test("normalizeShikiContrast remaps unreadable black comment foregrounds", async () => {
	const mod = await import("./diff-renderer.ts");
	const normalized = mod.__testing?.normalizeShikiContrast("\x1b[30m// comment\x1b[39m");

	assert.equal(typeof mod.__testing?.normalizeShikiContrast, "function");
	assert.equal(typeof normalized, "string");
	assert.doesNotMatch(normalized as string, /\x1b\[30m/);
	assert.match(normalized as string, /\x1b\[38;2;139;148;158m/);
});

test("renderSplit keeps added comment blocks readable", async () => {
	const mod = await import("./diff-renderer.ts");

	assert.equal(typeof mod.__testing?.parseDiff, "function");
	assert.equal(typeof mod.__testing?.renderSplit, "function");

	const diff = mod.__testing.parseDiff("", "// comment\nconst x = 1\n", 3);
	const rendered = await mod.__testing.renderSplit(diff, "typescript", 20);

	assert.doesNotMatch(rendered, /\x1b\[30m/);
	assert.match(rendered, /\x1b\[38;2;139;148;158m/);
});
