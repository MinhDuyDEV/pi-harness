#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const useProfile = process.argv[2] === "--profile";

if (process.argv[2] && process.argv[2] !== "--profile") {
	console.log("Usage: browser-start.js [--profile]");
	console.log("\nOptions:");
	console.log("  --profile  Copy your default Chrome profile (cookies, logins)");
	process.exit(1);
}

const home = process.env.HOME;
if (!home) {
	console.error("HOME is not set");
	process.exit(1);
}

const SCRAPING_DIR = join(home, ".cache", "browser-tools");
const CHROME_PROFILE_DIR = join(home, "Library", "Application Support", "Google", "Chrome");
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Check if already running on :9222
try {
	const browser = await puppeteer.connect({
		browserURL: "http://localhost:9222",
		defaultViewport: null,
	});
	await browser.disconnect();
	console.log("✓ Chrome already running on :9222");
	process.exit(0);
} catch (err) {
	// Not running yet — continue startup.
	void err;
}

mkdirSync(SCRAPING_DIR, { recursive: true });

for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
	try {
		unlinkSync(join(SCRAPING_DIR, name));
	} catch (err) {
		if (err && err.code !== "ENOENT") {
			console.error(`warning: failed to remove ${name}: ${err.message || err}`);
		}
	}
}

if (useProfile) {
	console.log("Syncing profile...");
	const result = spawnSync(
		"rsync",
		[
			"-a",
			"--delete",
			"--exclude=SingletonLock",
			"--exclude=SingletonSocket",
			"--exclude=SingletonCookie",
			"--exclude=*/Sessions/*",
			"--exclude=*/Current Session",
			"--exclude=*/Current Tabs",
			"--exclude=*/Last Session",
			"--exclude=*/Last Tabs",
			CHROME_PROFILE_DIR + "/",
			SCRAPING_DIR + "/",
		],
		{ stdio: "pipe", encoding: "utf8" },
	);
	if (result.status !== 0) {
		console.error(result.stderr || result.stdout || "rsync failed");
		process.exit(result.status ?? 1);
	}
}

spawn(
	CHROME_BIN,
	[
		"--remote-debugging-port=9222",
		"--user-data-dir=" + SCRAPING_DIR,
		"--no-first-run",
		"--no-default-browser-check",
	],
	{ detached: true, stdio: "ignore" },
).unref();

// Wait for Chrome to be ready
let connected = false;
for (let i = 0; i < 30; i++) {
	try {
		const browser = await puppeteer.connect({
			browserURL: "http://localhost:9222",
			defaultViewport: null,
		});
		await browser.disconnect();
		connected = true;
		break;
	} catch (err) {
		void err;
		await new Promise((r) => setTimeout(r, 500));
	}
}

if (!connected) {
	console.error("✗ Failed to connect to Chrome");
	process.exit(1);
}

console.log(`✓ Chrome started on :9222${useProfile ? " with your profile" : ""}`);
