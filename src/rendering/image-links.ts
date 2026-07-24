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

export function extractMarkdownImageLinks(markdown: string): string[] {
	const links: string[] = [];
	const markdownImagePattern = /!\[[^\]]*]\(([^)]+)\)/g;
	let match: RegExpExecArray | null;

	while ((match = markdownImagePattern.exec(markdown)) !== null) {
		links.push(normalizeImageLink(match[1]));
	}

	return links;
}
