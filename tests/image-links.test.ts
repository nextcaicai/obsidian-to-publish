import { describe, expect, it } from "vitest";

import {
	extractMarkdownImageLinks,
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
});
