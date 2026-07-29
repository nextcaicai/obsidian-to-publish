import { describe, expect, it } from "vitest";

import {
	extractMarkdownImageLinks,
	extractRenderedImageAttachmentTarget,
	extractStandaloneMarkdownImageAttachmentLinkTarget,
	extractStandaloneMarkdownImageEmbedTarget,
	normalizeImageLink
} from "../src/rendering/image-links";

describe("image links used for local image embedding", () => {
	it("normalizes an Obsidian image target into a vault path", () => {
		expect(normalizeImageLink(" images/cover%20photo.png|640#preview ")).toBe(
			"images/cover photo.png"
		);
	});

	it("keeps malformed URI escapes readable instead of rejecting the path", () => {
		expect(normalizeImageLink("images/100%cover.png")).toBe("images/100%cover.png");
	});

	it("extracts standard Markdown image targets in document order", () => {
		const markdown = [
			"![Cover](images/cover%20photo.png \"Cover image\")",
			"Some text.",
			"![Diagram](assets/diagram.svg#overview)"
		].join("\n");

		expect(extractMarkdownImageLinks(markdown)).toEqual([
			"images/cover photo.png",
			"assets/diagram.svg"
		]);
	});

	it("extracts rendered image attachment labels without depending on the Open prefix", () => {
		expect(extractRenderedImageAttachmentTarget("Open: CleanShot 2026-07-23 at 10.38.05@2x.png")).toBe(
			"CleanShot 2026-07-23 at 10.38.05@2x.png"
		);
		expect(extractRenderedImageAttachmentTarget("CleanShot 2026-07-23 at 10.38.05@2x.png")).toBe(
			"CleanShot 2026-07-23 at 10.38.05@2x.png"
		);
		expect(extractRenderedImageAttachmentTarget("打开: screenshots/demo.webp")).toBe(
			"screenshots/demo.webp"
		);
		expect(extractRenderedImageAttachmentTarget("Open:")).toBeNull();
		expect(extractRenderedImageAttachmentTarget("Preview: CleanShot.png")).toBeNull();
		expect(extractRenderedImageAttachmentTarget("Open: notes/design.md")).toBeNull();
	});

	it("extracts standalone pasted-image attachment link lines", () => {
		expect(extractStandaloneMarkdownImageAttachmentLinkTarget("[Open: img_v3_0213h.jpg](img_v3_0213h.jpg)")).toBe(
			"img_v3_0213h.jpg"
		);
		expect(extractStandaloneMarkdownImageAttachmentLinkTarget("[img_v3_0213h.jpg](img_v3_0213h.jpg)")).toBe(
			"img_v3_0213h.jpg"
		);
		expect(
			extractStandaloneMarkdownImageAttachmentLinkTarget(
				"[[01-Input/07-Clipping/assets/1de08e8764cff30f8cafe9be89366c9e_MD5.jpg|Open: img_v3_0213h_5ecc2d97-e788-44f5-aca9-03ff2f536b1g.jpg]]"
			)
		).toBe("01-Input/07-Clipping/assets/1de08e8764cff30f8cafe9be89366c9e_MD5.jpg");
		expect(extractStandaloneMarkdownImageAttachmentLinkTarget("[Open: notes/design.md](notes/design.md)")).toBeNull();
		expect(extractStandaloneMarkdownImageAttachmentLinkTarget("[[notes/design.md|Open: img.jpg]]")).toBeNull();
		expect(extractStandaloneMarkdownImageAttachmentLinkTarget("正文里的 [Open: img.jpg](img.jpg)")).toBeNull();
	});

	it("extracts standalone image embed lines for adjacency checks", () => {
		expect(extractStandaloneMarkdownImageEmbedTarget("![[img_v3_0213h.jpg]]")).toBe("img_v3_0213h.jpg");
		expect(extractStandaloneMarkdownImageEmbedTarget("![Screenshot](attachments/img_v3_0213h.jpg)")).toBe(
			"attachments/img_v3_0213h.jpg"
		);
		expect(extractStandaloneMarkdownImageEmbedTarget("[img_v3_0213h.jpg](img_v3_0213h.jpg)")).toBeNull();
	});
});
