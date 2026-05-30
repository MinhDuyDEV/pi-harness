#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const port = Number.parseInt(process.env.PORT || "4173", 10);

const contentTypes = new Map([
	[".html", "text/html; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".css", "text/css; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".svg", "image/svg+xml; charset=utf-8"],
]);

function resolveRequestPath(url) {
	const { pathname } = new URL(url, "http://localhost");
	const decodedPath = decodeURIComponent(pathname);
	const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
	const normalizedPath = normalize(relativePath);
	const filePath = resolve(join(root, normalizedPath));

	if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
		return null;
	}

	return filePath;
}

const server = createServer(async (request, response) => {
	if (!request.url || request.method !== "GET") {
		response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
		response.end("Method not allowed");
		return;
	}

	const filePath = resolveRequestPath(request.url);
	if (!filePath) {
		response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
		response.end("Forbidden");
		return;
	}

	try {
		const body = await readFile(filePath);
		response.writeHead(200, {
			"content-type": contentTypes.get(extname(filePath)) || "application/octet-stream",
		});
		response.end(body);
	} catch {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end("Not found");
	}
});

server.listen(port, () => {
	console.log(`Agent Workbench listening at http://localhost:${port}`);
});
