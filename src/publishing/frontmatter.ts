export interface ParsedArticleMetadata {
	body: string;
	title?: string;
	excerpt?: string;
	cover?: string;
	tags?: string[];
}

const PLACEHOLDER_TITLES = new Set(["待定", "暂定", "未定", "TBD", "tbd", "TBA", "tba", "WIP", "wip"]);

export function parseArticleMetadata(markdown: string, fallbackTitle = ""): ParsedArticleMetadata {
	const { body, meta } = parseFrontmatter(markdown);
	const rawTitle = decodeUnicodeEscapes(meta.title ?? meta.Title ?? meta["标题"] ?? "");
	const title = normalizeTitle(rawTitle) || firstH1Title(body) || normalizeTitle(fallbackTitle);
	const cover = normalizeCover(meta.cover ?? meta.Cover ?? meta["封面"] ?? "");
	const excerpt = normalizeOptionalText(meta.excerpt ?? meta.digest ?? meta.description ?? meta["摘要"] ?? "");
	const tags = normalizeTags(meta.tags ?? meta.tag ?? meta["标签"]);

	return {
		body: title ? removeDuplicateFirstH1(body, title) : body,
		...(title ? { title } : {}),
		...(excerpt ? { excerpt } : {}),
		...(cover ? { cover } : {}),
		...(tags.length ? { tags } : {})
	};
}

function parseFrontmatter(markdown: string): {
	body: string;
	meta: Record<string, string>;
} {
	if (!markdown.startsWith("---")) {
		return {
			body: markdown,
			meta: {}
		};
	}

	const end = markdown.indexOf("\n---", 3);
	if (end < 0) {
		return {
			body: markdown,
			meta: {}
		};
	}

	const frontmatter = markdown.slice(3, end).trim();
	const bodyStart = markdown.indexOf("\n", end + 4);
	const body = bodyStart >= 0 ? markdown.slice(bodyStart + 1) : "";
	const meta: Record<string, string> = {};
	let currentListKey = "";
	const listValues: Record<string, string[]> = {};

	for (const line of frontmatter.split(/\r?\n/)) {
		const listItem = /^\s*-\s+(.+)\s*$/.exec(line);
		if (listItem && currentListKey) {
			listValues[currentListKey] = listValues[currentListKey] ?? [];
			listValues[currentListKey].push(unquoteYamlScalar(listItem[1]));
			meta[currentListKey] = listValues[currentListKey].join(",");
			continue;
		}

		const match = /^([A-Za-z0-9_\u4e00-\u9fa5-]+):\s*(.*)$/.exec(line);
		if (!match) {
			currentListKey = "";
			continue;
		}

		currentListKey = match[1];
		meta[currentListKey] = unquoteYamlScalar(match[2]);
	}

	return {
		body,
		meta
	};
}

function normalizeTitle(value: string): string {
	const title = normalizeOptionalText(value);
	return title && !PLACEHOLDER_TITLES.has(title) ? title : "";
}

function normalizeOptionalText(value: string): string {
	return decodeUnicodeEscapes(value).trim();
}

function normalizeCover(value: string): string {
	return normalizeOptionalText(value)
		.replace(/^!\[\[|\]\]$/g, "")
		.replace(/^!\[[^\]]*\]\(([^)]+)\)$/u, "$1")
		.trim();
}

function normalizeTags(value: string | undefined): string[] {
	const raw = normalizeOptionalText(value ?? "");
	if (!raw) {
		return [];
	}

	const withoutBrackets = raw.replace(/^\[|\]$/g, "");
	return withoutBrackets
		.split(",")
		.map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
		.filter(Boolean);
}

function firstH1Title(markdown: string): string {
	const match = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown);
	return match ? normalizeTitle(match[1]) : "";
}

function removeDuplicateFirstH1(markdown: string, title: string): string {
	const lines = markdown.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line.trim()) {
			continue;
		}

		const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
		if (match && normalizeOptionalText(match[1]) === title) {
			return lines.slice(0, index).concat(lines.slice(index + 1)).join("\n").replace(/^\n+/, "");
		}

		return markdown;
	}

	return markdown;
}

function unquoteYamlScalar(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith("\"") && trimmed.endsWith("\""))
		|| (trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function decodeUnicodeEscapes(value: string): string {
	if (!value.includes("\\")) {
		return value;
	}

	return value
		.replace(/\\U([0-9a-fA-F]{8})/g, (match, hex) => codePointToString(hex, match))
		.replace(/\\u\{([0-9a-fA-F]+)\}/g, (match, hex) => codePointToString(hex, match))
		.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => codePointToString(hex, match));
}

function codePointToString(hex: string, fallback: string): string {
	try {
		return String.fromCodePoint(Number.parseInt(hex, 16));
	} catch {
		return fallback;
	}
}
