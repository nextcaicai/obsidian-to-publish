export function normalizeImageLink(link: string): string {
	let value = link.trim();
	if (!value) {
		return "";
	}

	const pipeIndex = value.indexOf("|");
	if (pipeIndex >= 0) {
		value = value.slice(0, pipeIndex);
	}

	const hashIndex = value.indexOf("#");
	if (hashIndex >= 0) {
		value = value.slice(0, hashIndex);
	}

	if (value.startsWith("<") && value.includes(">")) {
		value = value.slice(1, value.indexOf(">"));
	}

	const titleIndex = value.search(/\s+["']/);
	if (titleIndex > 0) {
		value = value.slice(0, titleIndex);
	}

	try {
		value = decodeURIComponent(value);
	} catch {
		// Keep the original value if it is not URI encoded.
	}

	return value.trim();
}

const IMAGE_FILE_EXTENSION_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const RENDERED_ATTACHMENT_PREFIX_PATTERN = /^(?:Open|Open file|打开|打开文件):\s*/i;
const STANDALONE_MARKDOWN_LINK_PATTERN = /^\[([^\]]+)]\(([^)]+)\)\s*$/;
const STANDALONE_WIKI_LINK_PATTERN = /^\[\[([^\]|]+)(?:\|([^\]]+))?]]\s*$/;
const STANDALONE_WIKI_IMAGE_PATTERN = /^!\[\[([^\]]+)]]\s*$/;

export function extractRenderedImageAttachmentTarget(text: string): string | null {
	const normalizedText = text.replace(/\s+/g, " ").trim();
	const withoutPrefix = normalizedText.replace(RENDERED_ATTACHMENT_PREFIX_PATTERN, "");
	if (withoutPrefix === normalizedText && /^[^/\\]+:\s+/.test(normalizedText)) {
		return null;
	}

	const target = normalizeImageLink(withoutPrefix);

	return IMAGE_FILE_EXTENSION_PATTERN.test(target) ? target : null;
}

export function extractStandaloneMarkdownImageAttachmentLinkTarget(line: string): string | null {
	const trimmedLine = line.trim();
	const wikiMatch = STANDALONE_WIKI_LINK_PATTERN.exec(trimmedLine);
	if (wikiMatch) {
		const linkTarget = normalizeImageLink(wikiMatch[1]);
		const aliasTarget = wikiMatch[2]
			? extractRenderedImageAttachmentTarget(wikiMatch[2])
			: null;
		return IMAGE_FILE_EXTENSION_PATTERN.test(linkTarget) && (!wikiMatch[2] || aliasTarget)
			? linkTarget
			: null;
	}

	const markdownMatch = STANDALONE_MARKDOWN_LINK_PATTERN.exec(trimmedLine);
	if (!markdownMatch) {
		return null;
	}

	const textTarget = extractRenderedImageAttachmentTarget(markdownMatch[1]);
	if (textTarget) {
		return textTarget;
	}

	const linkTarget = normalizeImageLink(markdownMatch[2]);
	return IMAGE_FILE_EXTENSION_PATTERN.test(linkTarget) ? linkTarget : null;
}

export function extractStandaloneMarkdownImageEmbedTarget(line: string): string | null {
	const trimmedLine = line.trim();
	const wikiMatch = STANDALONE_WIKI_IMAGE_PATTERN.exec(trimmedLine);
	if (wikiMatch) {
		return normalizeImageLink(wikiMatch[1]);
	}

	const links = extractMarkdownImageLinks(trimmedLine);
	return links.length === 1 && trimmedLine.startsWith("![") ? links[0] : null;
}

export function extractMarkdownImageLinks(markdown: string): string[] {
	const links: string[] = [];
	const markdownImagePattern = /!\[[^\]]*]\(([^)]+)\)/g;
	let match: RegExpExecArray | null;

	while ((match = markdownImagePattern.exec(markdown)) !== null) {
		links.push(normalizeImageLink(match[1]));
	}

	return links;
}
