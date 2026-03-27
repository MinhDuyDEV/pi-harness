/**
 * Google Stitch Extension — AI UI Design & Code Generation
 *
 * Native pi extension using @google/stitch-sdk to connect directly
 * to stitch.googleapis.com/mcp. Generates production-ready HTML/CSS
 * from text prompts via Gemini.
 *
 * Auth (env vars, checked in order):
 *   1. STITCH_API_KEY — Google API key
 *   2. STITCH_ACCESS_TOKEN + GOOGLE_CLOUD_PROJECT — OAuth bearer token
 *
 * 11 tools: 8 SDK tools + 3 virtual tools (get_screen_code, get_screen_image, build_site)
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Lazy-loaded SDK client (ESM-only package)
let client: any = null;

async function getClient(): Promise<any> {
	if (client) return client;

	const apiKey = process.env.STITCH_API_KEY;
	const accessToken = process.env.STITCH_ACCESS_TOKEN;
	const projectId = process.env.GOOGLE_CLOUD_PROJECT;

	if (!apiKey && !accessToken) {
		throw new Error(
			"Stitch auth not configured. Set STITCH_API_KEY or STITCH_ACCESS_TOKEN + GOOGLE_CLOUD_PROJECT env vars.\n" +
				"API key: https://aistudio.google.com/apikey\n" +
				"OAuth: gcloud auth application-default print-access-token",
		);
	}

	const { StitchToolClient } = await import("@google/stitch-sdk");
	const config: Record<string, string | undefined> = {};
	if (apiKey) {
		config.apiKey = apiKey;
	} else {
		config.accessToken = accessToken;
		config.projectId = projectId;
	}

	client = new StitchToolClient(config);
	return client;
}

async function callStitch(
	toolName: string,
	args: Record<string, any>,
): Promise<any> {
	const c = await getClient();
	return c.callTool(toolName, args);
}

function ok(text: string, details: Record<string, any> = {}) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

function err(message: string, details: Record<string, any> = {}) {
	return {
		content: [{ type: "text" as const, text: `Error: ${message}` }],
		details: { error: message, ...details },
	};
}

// Shared enum types
const DeviceTypeEnum = StringEnum(
	[
		"DEVICE_TYPE_UNSPECIFIED",
		"MOBILE",
		"DESKTOP",
		"TABLET",
		"AGNOSTIC",
	] as const,
	{ description: "Device type for the design" },
);

const ModelIdEnum = StringEnum(
	["MODEL_ID_UNSPECIFIED", "GEMINI_3_PRO", "GEMINI_3_FLASH"] as const,
	{ description: "Model to use for generation" },
);

export default function (pi: ExtensionAPI) {
	// ===== 1. create_project =====
	pi.registerTool({
		name: "stitch_create_project",
		label: "Stitch: Create Project",
		description:
			"Creates a new Stitch project. A project is a container for UI designs and frontend code.",
		promptSnippet: "Create a new Stitch project for UI designs.",
		parameters: Type.Object({
			title: Type.Optional(
				Type.String({ description: "Optional title for the project" }),
			),
		}),
		async execute(_id, params, _signal) {
			try {
				const result = await callStitch("create_project", params);
				return ok(JSON.stringify(result, null, 2), {
					tool: "create_project",
				});
			} catch (e: any) {
				return err(e.message, { tool: "create_project" });
			}
		},
	});

	// ===== 2. get_project =====
	pi.registerTool({
		name: "stitch_get_project",
		label: "Stitch: Get Project",
		description:
			"Retrieves details of a specific Stitch project by resource name.",
		promptSnippet: "Get Stitch project details.",
		parameters: Type.Object({
			name: Type.String({
				description:
					'Resource name of the project. Format: projects/{project}. Example: "projects/4044680601076201931"',
			}),
		}),
		async execute(_id, params, _signal) {
			try {
				const result = await callStitch("get_project", params);
				return ok(JSON.stringify(result, null, 2), {
					tool: "get_project",
				});
			} catch (e: any) {
				return err(e.message, { tool: "get_project" });
			}
		},
	});

	// ===== 3. list_projects =====
	pi.registerTool({
		name: "stitch_list_projects",
		label: "Stitch: List Projects",
		description:
			"Lists all Stitch projects accessible to the user. Defaults to owned projects.",
		promptSnippet: "List Stitch projects.",
		parameters: Type.Object({
			filter: Type.Optional(
				Type.String({
					description:
						'Filter projects. Supported: "view=owned" (default), "view=shared"',
				}),
			),
		}),
		async execute(_id, params, _signal) {
			try {
				const result = await callStitch("list_projects", params);
				return ok(JSON.stringify(result, null, 2), {
					tool: "list_projects",
				});
			} catch (e: any) {
				return err(e.message, { tool: "list_projects" });
			}
		},
	});

	// ===== 4. list_screens =====
	pi.registerTool({
		name: "stitch_list_screens",
		label: "Stitch: List Screens",
		description: "Lists all screens within a given Stitch project.",
		promptSnippet: "List screens in a Stitch project.",
		parameters: Type.Object({
			projectId: Type.String({
				description:
					'Project ID (without "projects/" prefix). Example: "4044680601076201931"',
			}),
		}),
		async execute(_id, params, _signal) {
			try {
				const result = await callStitch("list_screens", params);
				return ok(JSON.stringify(result, null, 2), {
					tool: "list_screens",
				});
			} catch (e: any) {
				return err(e.message, { tool: "list_screens" });
			}
		},
	});

	// ===== 5. get_screen =====
	pi.registerTool({
		name: "stitch_get_screen",
		label: "Stitch: Get Screen",
		description:
			"Retrieves details of a specific screen within a project, including HTML and screenshot download URLs.",
		promptSnippet: "Get Stitch screen details.",
		parameters: Type.Object({
			name: Type.String({
				description:
					'Resource name. Format: projects/{project}/screens/{screen}. Example: "projects/123/screens/abc"',
			}),
			projectId: Type.String({
				description: 'Project ID (without "projects/" prefix)',
			}),
			screenId: Type.String({
				description: 'Screen ID (without "screens/" prefix)',
			}),
		}),
		async execute(_id, params, _signal) {
			try {
				const result = await callStitch("get_screen", params);
				return ok(JSON.stringify(result, null, 2), {
					tool: "get_screen",
				});
			} catch (e: any) {
				return err(e.message, { tool: "get_screen" });
			}
		},
	});

	// ===== 6. generate_screen_from_text =====
	pi.registerTool({
		name: "stitch_generate_screen",
		label: "Stitch: Generate Screen",
		description: `Generates a new UI screen from a text prompt using Gemini.

**IMPORTANT:** This can take several minutes. DO NOT RETRY on timeout.
If it fails with a connection error, the generation may still succeed — use stitch_get_screen later.

The response may include output_components with suggestions. Present suggestions to the user; if accepted, call this tool again with the suggestion as the prompt.`,
		promptSnippet: "Generate a UI screen from a text description.",
		parameters: Type.Object({
			projectId: Type.String({
				description: "Project ID to generate the screen in",
			}),
			prompt: Type.String({
				description:
					'Text description of the UI to generate. Example: "A login page with email and password fields"',
			}),
			deviceType: Type.Optional(DeviceTypeEnum),
			modelId: Type.Optional(ModelIdEnum),
		}),
		async execute(_id, params, _signal) {
			try {
				const result = await callStitch(
					"generate_screen_from_text",
					params,
				);
				return ok(JSON.stringify(result, null, 2), {
					tool: "generate_screen_from_text",
				});
			} catch (e: any) {
				return err(e.message, { tool: "generate_screen_from_text" });
			}
		},
	});

	// ===== 7. edit_screens =====
	pi.registerTool({
		name: "stitch_edit_screens",
		label: "Stitch: Edit Screens",
		description: `Edits existing screens within a project using a text prompt.

**IMPORTANT:** This can take several minutes. DO NOT RETRY on timeout.`,
		promptSnippet: "Edit existing Stitch screens with a text prompt.",
		parameters: Type.Object({
			projectId: Type.String({
				description: "Project ID containing the screens",
			}),
			selectedScreenIds: Type.Array(Type.String(), {
				description: "Screen IDs to edit (array of strings)",
			}),
			prompt: Type.String({
				description: "Edit instructions for the screens",
			}),
			deviceType: Type.Optional(DeviceTypeEnum),
			modelId: Type.Optional(ModelIdEnum),
		}),
		async execute(_id, params, _signal) {
			try {
				const result = await callStitch("edit_screens", params);
				return ok(JSON.stringify(result, null, 2), {
					tool: "edit_screens",
				});
			} catch (e: any) {
				return err(e.message, { tool: "edit_screens" });
			}
		},
	});

	// ===== 8. generate_variants =====
	pi.registerTool({
		name: "stitch_generate_variants",
		label: "Stitch: Generate Variants",
		description:
			"Generates design variants of existing screens with configurable creative range and aspects.",
		promptSnippet: "Generate design variants of Stitch screens.",
		parameters: Type.Object({
			projectId: Type.String({
				description: "Project ID containing the screens",
			}),
			selectedScreenIds: Type.Array(Type.String(), {
				description: "Screen IDs to generate variants for",
			}),
			prompt: Type.String({
				description: "Text prompt guiding variant generation",
			}),
			variantOptions: Type.Object(
				{
					variantCount: Type.Optional(
						Type.Number({
							description:
								"Number of variants to generate (1-5, default: 3)",
						}),
					),
					creativeRange: Type.Optional(
						StringEnum(
							[
								"CREATIVE_RANGE_UNSPECIFIED",
								"REFINE",
								"EXPLORE",
								"REIMAGINE",
							] as const,
							{
								description:
									"Creative range: REFINE (subtle), EXPLORE (balanced, default), REIMAGINE (radical)",
							},
						),
					),
					aspects: Type.Optional(
						Type.Array(
							StringEnum(
								[
									"VARIANT_ASPECT_UNSPECIFIED",
									"LAYOUT",
									"COLOR_SCHEME",
									"IMAGES",
									"TEXT_FONT",
									"TEXT_CONTENT",
								] as const,
								{ description: "Aspect to vary" },
							),
							{
								description:
									"Aspects to focus on. Empty = vary everything.",
							},
						),
					),
				},
				{
					description:
						"Variant generation options (count, creative range, aspects)",
				},
			),
			deviceType: Type.Optional(DeviceTypeEnum),
			modelId: Type.Optional(ModelIdEnum),
		}),
		async execute(_id, params, _signal) {
			try {
				const result = await callStitch("generate_variants", params);
				return ok(JSON.stringify(result, null, 2), {
					tool: "generate_variants",
				});
			} catch (e: any) {
				return err(e.message, { tool: "generate_variants" });
			}
		},
	});

	// ===== 9. VIRTUAL: get_screen_code =====
	pi.registerTool({
		name: "stitch_get_screen_code",
		label: "Stitch: Get Screen Code",
		description:
			"Fetches the actual HTML/CSS code for a screen. Returns the HTML string directly (not just a download URL).",
		promptSnippet: "Get the HTML code for a Stitch screen.",
		parameters: Type.Object({
			projectId: Type.String({ description: "Project ID" }),
			screenId: Type.String({ description: "Screen ID" }),
		}),
		async execute(_id, params, _signal) {
			try {
				const { projectId, screenId } = params;
				const name = `projects/${projectId}/screens/${screenId}`;
				const screen = await callStitch("get_screen", {
					name,
					projectId,
					screenId,
				});

				const downloadUrl =
					screen?.htmlCode?.downloadUrl ??
					screen?.html_code?.download_url;
				if (!downloadUrl) {
					return err(
						"Screen has no HTML download URL. The screen may not have been generated yet.",
						{ tool: "get_screen_code", screen },
					);
				}

				const response = await fetch(downloadUrl);
				if (!response.ok) {
					return err(
						`Failed to fetch HTML: HTTP ${response.status}`,
						{ tool: "get_screen_code", url: downloadUrl },
					);
				}

				const html = await response.text();
				return ok(html, {
					tool: "get_screen_code",
					projectId,
					screenId,
					length: html.length,
				});
			} catch (e: any) {
				return err(e.message, { tool: "get_screen_code" });
			}
		},
	});

	// ===== 10. VIRTUAL: get_screen_image =====
	pi.registerTool({
		name: "stitch_get_screen_image",
		label: "Stitch: Get Screen Image",
		description:
			"Fetches the screenshot PNG for a screen and returns it as a base64-encoded string.",
		promptSnippet: "Get the screenshot image for a Stitch screen.",
		parameters: Type.Object({
			projectId: Type.String({ description: "Project ID" }),
			screenId: Type.String({ description: "Screen ID" }),
		}),
		async execute(_id, params, _signal) {
			try {
				const { projectId, screenId } = params;
				const name = `projects/${projectId}/screens/${screenId}`;
				const screen = await callStitch("get_screen", {
					name,
					projectId,
					screenId,
				});

				const downloadUrl =
					screen?.screenshot?.downloadUrl ??
					screen?.screenshot?.download_url;
				if (!downloadUrl) {
					return err(
						"Screen has no screenshot URL. The screen may not have been generated yet.",
						{ tool: "get_screen_image", screen },
					);
				}

				const response = await fetch(downloadUrl);
				if (!response.ok) {
					return err(
						`Failed to fetch screenshot: HTTP ${response.status}`,
						{ tool: "get_screen_image", url: downloadUrl },
					);
				}

				const buffer = await response.arrayBuffer();
				const base64 = Buffer.from(buffer).toString("base64");
				return ok(`data:image/png;base64,${base64}`, {
					tool: "get_screen_image",
					projectId,
					screenId,
					sizeBytes: buffer.byteLength,
				});
			} catch (e: any) {
				return err(e.message, { tool: "get_screen_image" });
			}
		},
	});

	// ===== 11. VIRTUAL: build_site =====
	pi.registerTool({
		name: "stitch_build_site",
		label: "Stitch: Build Site",
		description: `Builds a multi-page site by fetching HTML for multiple screens and assembling them with route mappings.

Accepts a route mapping (path → screenId) and returns all HTML files organized by route. Useful for turning Stitch screens into a deployable multi-page site.`,
		promptSnippet: "Build a multi-page site from Stitch screens.",
		parameters: Type.Object({
			projectId: Type.String({ description: "Project ID" }),
			routes: Type.Array(
				Type.Object({
					path: Type.String({
						description:
							'URL path for this page. Example: "/", "/about", "/login"',
					}),
					screenId: Type.String({
						description: "Screen ID to use for this route",
					}),
				}),
				{
					description:
						"Array of route-to-screen mappings. Each entry maps a URL path to a screen ID.",
				},
			),
		}),
		async execute(_id, params, _signal) {
			try {
				const { projectId, routes } = params;
				const pages: Array<{
					path: string;
					screenId: string;
					html: string;
				}> = [];
				const errors: Array<{
					path: string;
					screenId: string;
					error: string;
				}> = [];

				for (const route of routes) {
					try {
						const name = `projects/${projectId}/screens/${route.screenId}`;
						const screen = await callStitch("get_screen", {
							name,
							projectId,
							screenId: route.screenId,
						});

						const downloadUrl =
							screen?.htmlCode?.downloadUrl ??
							screen?.html_code?.download_url;
						if (!downloadUrl) {
							errors.push({
								path: route.path,
								screenId: route.screenId,
								error: "No HTML download URL",
							});
							continue;
						}

						const response = await fetch(downloadUrl);
						if (!response.ok) {
							errors.push({
								path: route.path,
								screenId: route.screenId,
								error: `HTTP ${response.status}`,
							});
							continue;
						}

						const html = await response.text();
						pages.push({
							path: route.path,
							screenId: route.screenId,
							html,
						});
					} catch (e: any) {
						errors.push({
							path: route.path,
							screenId: route.screenId,
							error: e.message,
						});
					}
				}

				const result = {
					projectId,
					totalRoutes: routes.length,
					successCount: pages.length,
					errorCount: errors.length,
					pages: pages.map((p) => ({
						path: p.path,
						screenId: p.screenId,
						htmlLength: p.html.length,
						html: p.html,
					})),
					errors: errors.length > 0 ? errors : undefined,
				};

				return ok(JSON.stringify(result, null, 2), {
					tool: "build_site",
					projectId,
					routes: routes.length,
					success: pages.length,
					failed: errors.length,
				});
			} catch (e: any) {
				return err(e.message, { tool: "build_site" });
			}
		},
	});

	// ===== Cleanup on session shutdown =====
	pi.on("session_shutdown", async () => {
		if (client) {
			try {
				await client.close();
			} catch {
				// Ignore close errors during shutdown
			}
			client = null;
		}
	});
}
