import { describe, expect, it } from "vitest";

import { collectArticleImageReferences, resolveArticleAssets } from "../src/publishing/assets";
import { parseArticleMetadata } from "../src/publishing/frontmatter";
import { buildPublishPackageV1 } from "../src/publishing/package";
import type { PublishImageResolver } from "../src/publishing/types";

const encoder = new TextEncoder();

function bytes(value: string): ArrayBuffer {
	return encoder.encode(value).buffer as ArrayBuffer;
}

const resolveImage: PublishImageResolver = async (src) => {
	if (src === "images/cover.png") {
		return {
			path: "images/cover.png",
			fileName: "cover.png",
			mime: "image/png",
			data: bytes("cover")
		};
	}

	if (src === "images/diagram.svg") {
		return {
			path: "images/diagram.svg",
			fileName: "diagram.svg",
			mime: "image/svg+xml",
			data: bytes("<svg />")
		};
	}

	if (src === "images/body.png") {
		return {
			path: "images/body.png",
			fileName: "body.png",
			mime: "image/png",
			data: bytes("body")
		};
	}

	return null;
};

describe("publish package", () => {
	it("extracts metadata and removes a duplicate first H1", () => {
		const parsed = parseArticleMetadata([
			"---",
			"title: 文章标题",
			"excerpt: 摘要",
			"tags:",
			"  - obsidian",
			"  - publish",
			"---",
			"# 文章标题",
			"",
			"正文"
		].join("\n"));

		expect(parsed.title).toBe("文章标题");
		expect(parsed.excerpt).toBe("摘要");
		expect(parsed.tags).toEqual(["obsidian", "publish"]);
		expect(parsed.body).toBe("正文");
	});

	it("collects markdown and wiki image references outside code", () => {
		const refs = collectArticleImageReferences([
			"![Cover](images/cover.png \"cover\")",
			"`![Nope](images/inline.png)`",
			"",
			"```md",
			"![Nope](images/code.png)",
			"```",
			"",
			"![[images/diagram.svg|Diagram]]"
		].join("\n"));

		expect(refs.map((ref) => ref.src)).toEqual(["images/cover.png", "images/diagram.svg"]);
		expect(refs.map((ref) => ref.alt)).toEqual(["Cover", "Diagram"]);
	});

	it("replaces local images with asset urls and preserves remote images", async () => {
		const result = await resolveArticleAssets([
			"![Cover](images/cover.png)",
			"![Remote](https://example.com/remote.png)",
			"![[images/diagram.svg|Diagram]]"
		].join("\n"), resolveImage);

		expect(result.assets).toHaveLength(2);
		expect(result.markdown).toContain("![Cover](asset://asset_1)");
		expect(result.markdown).toContain("![Diagram](asset://asset_2)");
		expect(result.markdown).toContain("![Remote](https://example.com/remote.png)");
		expect(result.warnings).toEqual([]);
	});

	it("returns warnings for missing local images", async () => {
		const result = await resolveArticleAssets("![Missing](missing.png)", resolveImage);

		expect(result.assets).toEqual([]);
		expect(result.markdown).toBe("![Missing](missing.png)");
		expect(result.warnings).toEqual([
			{
				code: "image_local_missing",
				message: "本地图片未找到：missing.png",
				target: "missing.png"
			}
		]);
	});

	it("builds a PublishPackageV1 for Chrome companion imports", async () => {
		const pkg = await buildPublishPackageV1({
			requestId: "pub_test",
			createdAt: "2026-08-04T00:00:00.000Z",
			targets: ["x", "juejin"],
			note: {
				path: "notes/post.md",
				basename: "post",
				mtime: 123
			},
			markdown: [
				"---",
				"title: X Article",
				"cover: images/cover.png",
				"---",
				"# X Article",
				"",
				"![Cover](images/cover.png)",
				"",
				"正文"
			].join("\n"),
			html: "<section>正文</section>",
			text: "正文",
			resolveImage
		});

		expect(pkg.version).toBe(1);
		expect(pkg.source).toBe("obsidian-to-publish");
		expect(pkg.article.title).toBe("X Article");
		expect(pkg.article.markdown).not.toContain("# X Article");
		expect(pkg.article.markdown).toContain("![Cover](asset://asset_1)");
		expect(pkg.article.cover).toBe("asset://asset_1");
		expect(pkg.assets[0]).toMatchObject({
			id: "asset_1",
			kind: "image",
			originalSrc: "images/cover.png",
			fileName: "cover.png",
			mime: "image/png"
		});
		expect(pkg.options.overwriteExistingDraft).toBe("ask");
	});

	it("maps cover to the matching asset instead of the first image", async () => {
		const pkg = await buildPublishPackageV1({
			requestId: "pub_cover",
			createdAt: "2026-08-04T00:00:00.000Z",
			targets: ["x"],
			note: {
				path: "notes/post.md",
				basename: "post"
			},
			markdown: [
				"---",
				"title: Cover mapping",
				"cover: images/cover.png",
				"---",
				"![Body](images/body.png)",
				"![Cover](images/cover.png)"
			].join("\n"),
			html: "<section>正文</section>",
			text: "正文",
			resolveImage
		});

		expect(pkg.article.cover).toBe("asset://asset_2");
	});
});
