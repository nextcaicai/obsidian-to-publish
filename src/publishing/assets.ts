import { normalizeImageLink } from "../rendering/image-links";
import type {
	PublishAsset,
	PublishImageResolver,
	PublishWarning,
	ResolvedPublishImage
} from "./types";

export interface ArticleAssetResult {
	markdown: string;
	assets: PublishAsset[];
	warnings: PublishWarning[];
	firstImageSrc: string;
}

interface ImageReference {
	start: number;
	end: number;
	alt: string;
	src: string;
	raw: string;
}

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)]\(([^)\n]+)\)/g;
const WIKI_IMAGE_PATTERN = /!\[\[([^\]\n]+)]]/g;
const PORTABLE_IMAGE_PATTERN = /^(?:https?:|data:image\/|asset:\/\/)/i;

export async function resolveArticleAssets(
	markdown: string,
	resolveImage: PublishImageResolver
): Promise<ArticleAssetResult> {
	const source = String(markdown || "");
	const references = collectArticleImageReferences(source);
	const assets: PublishAsset[] = [];
	const warnings: PublishWarning[] = [];
	const replacements: Array<{ start: number; end: number; value: string }> = [];
	const assetByResolvedPath = new Map<string, PublishAsset>();
	let firstImageSrc = "";

	for (const reference of references) {
		const normalizedSrc = normalizeImageLink(reference.src);
		if (!firstImageSrc) {
			firstImageSrc = normalizedSrc;
		}

		if (!normalizedSrc || isPortableImageSource(normalizedSrc)) {
			continue;
		}

		const resolved = await resolveImage(normalizedSrc);
		if (!resolved) {
			warnings.push({
				code: "image_local_missing",
				message: `本地图片未找到：${normalizedSrc}`,
				target: normalizedSrc
			});
			continue;
		}

		const key = resolved.path || normalizedSrc;
		let asset = assetByResolvedPath.get(key);
		if (!asset) {
			asset = createPublishAsset(reference, resolved, assets.length + 1);
			assets.push(asset);
			assetByResolvedPath.set(key, asset);
		}

		replacements.push({
			start: reference.start,
			end: reference.end,
			value: createMarkdownImage(reference.alt || asset.fileName, `asset://${asset.id}`)
		});
	}

	return {
		markdown: replaceRanges(source, replacements),
		assets,
		warnings,
		firstImageSrc
	};
}

export function collectArticleImageReferences(markdown: string): ImageReference[] {
	const ignoredRanges = collectIgnoredMarkdownRanges(markdown);
	const references: ImageReference[] = [];
	let match: RegExpExecArray | null;

	MARKDOWN_IMAGE_PATTERN.lastIndex = 0;
	while ((match = MARKDOWN_IMAGE_PATTERN.exec(markdown)) !== null) {
		if (isIgnoredIndex(match.index, ignoredRanges)) {
			continue;
		}

		references.push({
			start: match.index,
			end: match.index + match[0].length,
			alt: match[1].trim(),
			src: normalizeMarkdownImageDestination(match[2]),
			raw: match[0]
		});
	}

	WIKI_IMAGE_PATTERN.lastIndex = 0;
	while ((match = WIKI_IMAGE_PATTERN.exec(markdown)) !== null) {
		if (isIgnoredIndex(match.index, ignoredRanges)) {
			continue;
		}

		const parsed = parseWikiImage(match[1]);
		references.push({
			start: match.index,
			end: match.index + match[0].length,
			alt: parsed.alt,
			src: parsed.src,
			raw: match[0]
		});
	}

	return references.sort((left, right) => left.start - right.start);
}

function createPublishAsset(reference: ImageReference, resolved: ResolvedPublishImage, index: number): PublishAsset {
	return {
		id: `asset_${index}`,
		kind: "image",
		originalSrc: normalizeImageLink(reference.src),
		fileName: resolved.fileName,
		mime: resolved.mime,
		bytes: resolved.data.byteLength,
		base64: arrayBufferToBase64(resolved.data)
	};
}

function normalizeMarkdownImageDestination(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("<") && trimmed.includes(">")) {
		return trimmed.slice(1, trimmed.indexOf(">"));
	}

	const titleIndex = trimmed.search(/\s+["']/);
	return titleIndex > 0 ? trimmed.slice(0, titleIndex) : trimmed;
}

function parseWikiImage(value: string): {
	src: string;
	alt: string;
} {
	const [src, alias = ""] = value.split("|");
	const normalizedSrc = normalizeImageLink(src);
	const normalizedAlias = alias.trim();
	const alt = normalizedAlias && !/^\d+(?:x\d+)?$/.test(normalizedAlias)
		? normalizedAlias
		: imageAltFromPath(normalizedSrc);
	return {
		src: normalizedSrc,
		alt
	};
}

function imageAltFromPath(path: string): string {
	const fileName = path.replace(/\\/g, "/").split("/").pop() ?? "image";
	return fileName.replace(/\.[a-z0-9]+$/i, "") || "image";
}

function createMarkdownImage(alt: string, src: string): string {
	return `![${alt.replace(/[\]\r\n]+/g, " ").trim() || "image"}](${src})`;
}

function replaceRanges(markdown: string, replacements: Array<{ start: number; end: number; value: string }>): string {
	return replacements
		.sort((left, right) => right.start - left.start)
		.reduce(
			(output, replacement) => output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end),
			markdown
		);
}

function isPortableImageSource(src: string): boolean {
	return PORTABLE_IMAGE_PATTERN.test(src);
}

function collectIgnoredMarkdownRanges(markdown: string): Array<{ start: number; end: number }> {
	return collectFencedCodeRanges(markdown).concat(collectInlineCodeRanges(markdown));
}

function collectFencedCodeRanges(markdown: string): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	const fencePattern = /^( {0,3})(`{3,}|~{3,})[^\n]*$/gm;
	let match: RegExpExecArray | null;

	while ((match = fencePattern.exec(markdown)) !== null) {
		const marker = match[2][0];
		const markerLength = match[2].length;
		const closePattern = new RegExp(`^( {0,3})${escapeRegExp(marker.repeat(markerLength))}[${marker}]*\\s*$`, "gm");
		closePattern.lastIndex = fencePattern.lastIndex;
		const close = closePattern.exec(markdown);
		const end = close ? close.index + close[0].length : markdown.length;
		ranges.push({
			start: match.index,
			end
		});
		fencePattern.lastIndex = end;
	}

	return ranges;
}

function collectInlineCodeRanges(markdown: string): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	const inlineCodePattern = /`[^`\n]+`/g;
	let match: RegExpExecArray | null;

	while ((match = inlineCodePattern.exec(markdown)) !== null) {
		ranges.push({
			start: match.index,
			end: match.index + match[0].length
		});
	}

	return ranges;
}

function isIgnoredIndex(index: number, ranges: Array<{ start: number; end: number }>): boolean {
	return ranges.some((range) => index >= range.start && index < range.end);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	let binary = "";

	for (let index = 0; index < bytes.length; index += chunkSize) {
		const chunk = bytes.subarray(index, index + chunkSize);
		binary += String.fromCharCode(...chunk);
	}

	return btoa(binary);
}

