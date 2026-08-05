import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const assetTools = require("../../chrome-companion/src/assets/publish-assets.js") as {
	uploadMarkdownAssets: (input: {
		markdown: string;
		assets: PublishAsset[];
		uploadAsset: (asset: PublishAsset) => Promise<{ url: string }>;
		cache?: Map<string, { url: string }>;
		concurrency?: number;
		retries?: number;
		retryDelayMs?: number;
		logger?: { warn: (...args: unknown[]) => void };
	}) => Promise<{
		markdown: string;
		urlByAssetId: Map<string, string>;
		uploads: Array<{ assetId: string; url: string; error?: string }>;
	}>;
};

type PublishAsset = {
	id: string;
	kind: "image";
	fileName: string;
	mime: string;
	bytes: number;
	base64: string;
};

function imageAsset(id: string, base64: string): PublishAsset {
	return {
		id,
		kind: "image",
		fileName: `${id}.png`,
		mime: "image/png",
		bytes: base64.length,
		base64
	};
}

describe("Chrome companion publish assets", () => {
	it("uploads duplicate image content once and rewrites every markdown reference", async () => {
		const uploadAsset = vi.fn(async (asset: PublishAsset) => ({
			url: `https://cdn.example.com/${asset.id}.png`
		}));

		const result = await assetTools.uploadMarkdownAssets({
			markdown: [
				"![First](asset://asset_1)",
				"",
				"![Duplicate](asset://asset_2)"
			].join("\n"),
			assets: [
				imageAsset("asset_1", "same-image"),
				imageAsset("asset_2", "same-image")
			],
			uploadAsset,
			concurrency: 2
		});

		expect(uploadAsset).toHaveBeenCalledTimes(1);
		expect(result.markdown).toContain("![First](https://cdn.example.com/asset_1.png)");
		expect(result.markdown).toContain("![Duplicate](https://cdn.example.com/asset_1.png)");
		expect(result.urlByAssetId.get("asset_2")).toBe("https://cdn.example.com/asset_1.png");
	});

	it("keeps the article importable when one image upload fails", async () => {
		const logger = {
			warn: vi.fn()
		};
		const uploadAsset = vi.fn(async (asset: PublishAsset) => {
			if (asset.id === "asset_2") {
				throw new Error("network failed");
			}
			return {
				url: `https://cdn.example.com/${asset.id}.png`
			};
		});

		const result = await assetTools.uploadMarkdownAssets({
			markdown: "![Ok](asset://asset_1)\n![Bad](asset://asset_2)",
			assets: [
				imageAsset("asset_1", "one"),
				imageAsset("asset_2", "two")
			],
			uploadAsset,
			concurrency: 1,
			retries: 0,
			logger
		});

		expect(result.markdown).toContain("![Ok](https://cdn.example.com/asset_1.png)");
		expect(result.markdown).toContain("[[OTP_IMAGE_asset_2_UPLOAD_FAILED]]");
		expect(logger.warn).toHaveBeenCalledTimes(1);
	});

	it("uses the upload cache by image fingerprint", async () => {
		const cache = new Map<string, { url: string }>();
		const uploadAsset = vi.fn(async () => ({
			url: "https://cdn.example.com/uploaded.png"
		}));
		const asset = imageAsset("asset_1", "cached-image");

		const first = await assetTools.uploadMarkdownAssets({
			markdown: "![A](asset://asset_1)",
			assets: [asset],
			uploadAsset,
			cache
		});
		const second = await assetTools.uploadMarkdownAssets({
			markdown: "![A](asset://asset_1)",
			assets: [asset],
			uploadAsset,
			cache
		});

		expect(uploadAsset).toHaveBeenCalledTimes(1);
		expect(first.markdown).toBe("![A](https://cdn.example.com/uploaded.png)");
		expect(second.markdown).toBe("![A](https://cdn.example.com/uploaded.png)");
	});
});
