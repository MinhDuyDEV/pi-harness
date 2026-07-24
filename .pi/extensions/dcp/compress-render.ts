/**
 * TUI render for DCP compress tool — collapsed preview + ctrl+o expand (Pi 0.81).
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown } from "@earendil-works/pi-tui";

const TOOL_RESULT_BG: Parameters<Theme["bg"]>[0] = "toolSuccessBg";
const COLLAPSED_PREVIEW_CHARS = 1_500;
const ESC_RE = "\u001b";
const ANSI_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([0-9;]*)m`, "g");
const RESET_WITHOUT_BG = "\x1b[22;23;24;25;27;28;29;39m";

type MarkdownTheme = {
	heading: (text: string) => string;
	link: (text: string) => string;
	linkUrl: (url: string) => string;
	code: (text: string) => string;
	codeBlock: (text: string) => string;
	codeBlockBorder: (text: string) => string;
	quote: (text: string) => string;
	quoteBorder: (text: string) => string;
	hr: (text: string) => string;
	listBullet: (text: string) => string;
	bold: (text: string) => string;
	italic: (text: string) => string;
	strikethrough: (text: string) => string;
	underline: (text: string) => string;
};

type TextContent = { type?: string; text?: string };
type ToolResultLike = {
	content?: TextContent[];
	details?: Record<string, unknown>;
	isError?: boolean;
};

function firstText(result: ToolResultLike): string {
	for (const block of result.content ?? []) {
		if (block.type === "text" && typeof block.text === "string") return block.text;
	}
	return "";
}

function paginateText(text: string, expanded: boolean): { page: string } {
	if (expanded) return { page: text };
	const page =
		text.length > COLLAPSED_PREVIEW_CHARS
			? `${text.slice(0, COLLAPSED_PREVIEW_CHARS)}… (ctrl+o to expand)`
			: text;
	return { page };
}

function toMarkdownTheme(theme: Theme): MarkdownTheme {
	return {
		heading: (text) => theme.fg("mdHeading", text),
		link: (text) => theme.fg("mdLink", text),
		linkUrl: (url) => theme.fg("mdLinkUrl", url),
		code: (text) => theme.fg("mdCode", text),
		codeBlock: (text) => theme.fg("mdCode", text),
		codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
		quote: (text) => theme.fg("mdQuote", text),
		quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
		hr: (text) => theme.fg("mdHr", text),
		listBullet: (text) => theme.fg("mdListBullet", text),
		bold: (text) => theme.bold(text),
		italic: (text) => theme.italic(text),
		strikethrough: (text) => theme.fg("dim", text),
		underline: (text) => theme.underline(text),
	};
}

function preserveBoxBackground(ansi: string): string {
	return ansi.replace(ANSI_CAPTURE_RE, (_seq, params: string) => {
		if (!params || params === "0") return RESET_WITHOUT_BG;
		const parts = params.split(";").filter(Boolean);
		const kept: string[] = [];
		let i = 0;
		while (i < parts.length) {
			const code = Number(parts[i]);
			if (code === 38) {
				kept.push(parts[i]);
				if (parts[i + 1] === "5") {
					kept.push(parts[i + 1], parts[i + 2]);
					i += 3;
				} else if (parts[i + 1] === "2") {
					kept.push(parts[i + 1], parts[i + 2], parts[i + 3], parts[i + 4]);
					i += 5;
				} else {
					i++;
				}
			} else if (code === 48) {
				if (parts[i + 1] === "5") i += 3;
				else if (parts[i + 1] === "2") i += 6;
				else i++;
			} else if (code === 49 || (code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
				i++;
			} else {
				kept.push(parts[i]);
				i++;
			}
		}
		return kept.length ? `\x1b[${kept.join(";")}m` : "";
	});
}

function wrapMarkdown(theme: Theme, markdown: string): InstanceType<typeof Box> {
	const md = new Markdown(markdown, 0, 0, toMarkdownTheme(theme));
	const box = new Box(0, 0);
	box.addChild(md);
	box.setBgFn((text) => theme.bg(TOOL_RESULT_BG, preserveBoxBackground(text)));
	return box;
}

export function renderCompressResult(
	result: ToolResultLike,
	options: { expanded?: boolean; isPartial?: boolean },
	theme: Theme,
): InstanceType<typeof Box> {
	const raw = firstText(result);
	const expanded = options.expanded ?? false;
	const { page } = paginateText(raw, expanded);
	return wrapMarkdown(theme, page);
}