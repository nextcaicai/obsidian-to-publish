import type { CopyPlatform } from "../platforms/types";
import { normalizeImageLink } from "../rendering/image-links";
import { parseArticleMetadata } from "./frontmatter";
import {
	createPublishAssetFromResolved,
	resolveArticleAssets
} from "./assets";
import type {
	PublishAsset,
	PublishImageResolver,
	PublishPackageV1,
	PublishWarning
} from "./types";

export interface BuildPublishPackageOptions {
	requestId?: string;
	createdAt?: string;
	targets: CopyPlatform[];
	note: {
		path: string;
		basename: string;
		mtime?: number;
	};
	markdown: string;
	html: string;
	text: string;
	resolveImage: PublishImageResolver;
	openEditor?: boolean;
	overwriteExistingDraft?: "ask" | "never" | "allow";
	uploadRemoteImages?: "never" | "ask";
}

export async function buildPublishPackageV1(options: BuildPublishPackageOptions): Promise<PublishPackageV1> {
	const metadata = parseArticleMetadata(options.markdown, options.note.basename);
	const assetResult = await resolveArticleAssets(metadata.body, options.resolveImage);
	const warnings: PublishWarning[] = [...assetResult.warnings];
	const assets = [...assetResult.assets];
	const cover = await resolvePublishCoverSource(
		metadata.cover || assetResult.firstImageSrc || "",
		assets,
		options.resolveImage,
		warnings
	);

	return {
		version: 1,
		source: "obsidian-to-publish",
		requestId: options.requestId ?? createPublishRequestId(),
		createdAt: options.createdAt ?? new Date().toISOString(),
		targets: options.targets,
		note: {
			path: options.note.path,
			basename: options.note.basename,
			...(typeof options.note.mtime === "number" ? { mtime: options.note.mtime } : {})
		},
		article: {
			title: metadata.title || options.note.basename,
			markdown: assetResult.markdown,
			html: options.html,
			text: options.text,
			...(metadata.excerpt ? { excerpt: metadata.excerpt } : {}),
			...(cover ? { cover } : {}),
			...(metadata.tags?.length ? { tags: metadata.tags } : {})
		},
		assets,
		warnings,
		options: {
			openEditor: options.openEditor ?? true,
			overwriteExistingDraft: options.overwriteExistingDraft ?? "ask",
			uploadRemoteImages: options.uploadRemoteImages ?? "never"
		}
	};
}

async function resolvePublishCoverSource(
	cover: string,
	assets: PublishAsset[],
	resolveImage: PublishImageResolver,
	warnings: PublishWarning[]
): Promise<string> {
	const normalizedCover = cover.trim();
	if (!normalizedCover) {
		return "";
	}

	const normalizedLink = normalizeImageLink(normalizedCover);
	const asset = assets.find((item) => normalizeImageLink(item.originalSrc) === normalizedLink);
	if (asset) {
		return `asset://${asset.id}`;
	}

	if (isPortableCoverSource(normalizedLink)) {
		return normalizedCover;
	}

	const resolved = await resolveImage(normalizedLink);
	if (!resolved) {
		warnings.push({
			code: "cover_local_missing",
			message: `封面图片未找到：${normalizedLink}`,
			target: normalizedLink
		});
		return normalizedCover;
	}

	const coverAsset = createPublishAssetFromResolved(normalizedLink, resolved, assets.length + 1);
	assets.push(coverAsset);
	return `asset://${coverAsset.id}`;
}

function isPortableCoverSource(src: string): boolean {
	return /^(?:https?:|data:image\/|asset:\/\/)/i.test(src);
}

function createPublishRequestId(): string {
	return `pub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
