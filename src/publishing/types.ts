import type { CopyPlatform } from "../platforms/types";

export interface PublishPackageV1 {
	version: 1;
	source: "obsidian-to-publish";
	requestId: string;
	createdAt: string;
	targets: CopyPlatform[];
	note: {
		path: string;
		basename: string;
		mtime?: number;
	};
	article: {
		title: string;
		markdown: string;
		html: string;
		text: string;
		excerpt?: string;
		cover?: string;
		tags?: string[];
	};
	assets: PublishAsset[];
	warnings: PublishWarning[];
	options: {
		openEditor: boolean;
		overwriteExistingDraft: "ask" | "never" | "allow";
		uploadRemoteImages: "never" | "ask";
	};
}

export interface PublishAsset {
	id: string;
	kind: "image";
	originalSrc: string;
	fileName: string;
	mime: string;
	bytes: number;
	base64: string;
	sha256?: string;
	width?: number;
	height?: number;
}

export interface PublishWarning {
	code: string;
	message: string;
	target?: string;
	detail?: Record<string, unknown>;
}

export interface ResolvedPublishImage {
	path: string;
	fileName: string;
	mime: string;
	data: ArrayBuffer;
	mtime?: number;
}

export type PublishImageResolver = (src: string) => Promise<ResolvedPublishImage | null>;

