import { describe, expect, it } from "vitest";

import {
	replacePreviewFragment,
	shouldReplacePreviewFragment,
	shouldSkipPreviewRender,
	type PreviewRenderKey
} from "../src/rendering/preview-refresh";

function key(overrides: Partial<PreviewRenderKey> = {}): PreviewRenderKey {
	return {
		filePath: "notes/demo.md",
		markdown: "# Hello",
		platform: "wechat",
		inlineStyles: true,
		embedLocalImages: true,
		...overrides
	};
}

describe("shouldSkipPreviewRender", () => {
	it("skips when the same note, markdown, platform and image settings are already on screen", () => {
		expect(shouldSkipPreviewRender(key(), key())).toBe(true);
	});

	it("does not skip the first render", () => {
		expect(shouldSkipPreviewRender(null, key())).toBe(false);
	});

	it("does not skip when the note text changed", () => {
		expect(shouldSkipPreviewRender(key(), key({ markdown: "# Hello world" }))).toBe(false);
	});

	it("does not skip when switching to another note", () => {
		expect(shouldSkipPreviewRender(key(), key({ filePath: "notes/other.md" }))).toBe(false);
	});

	it("does not skip when the target platform changed", () => {
		expect(shouldSkipPreviewRender(key(), key({ platform: "feishu" }))).toBe(false);
	});

	it("does not skip when local image embedding or inline styles changed", () => {
		expect(shouldSkipPreviewRender(key(), key({ embedLocalImages: false }))).toBe(false);
		expect(shouldSkipPreviewRender(key(), key({ inlineStyles: false }))).toBe(false);
	});

	it("does not skip a forced refresh even when nothing changed", () => {
		expect(shouldSkipPreviewRender(key(), key(), { force: true })).toBe(false);
	});

	it("skips a repeated empty state so closing the last note does not flash twice", () => {
		const empty = key({ filePath: null, markdown: "" });
		expect(shouldSkipPreviewRender(empty, empty)).toBe(true);
		expect(shouldSkipPreviewRender(key(), empty)).toBe(false);
	});
});

describe("preview fragment swap", () => {
	it("keeps the current preview when the next HTML is identical", () => {
		expect(shouldReplacePreviewFragment("<p>Hello</p>", "<p>Hello</p>")).toBe(false);
	});

	it("replaces the preview when the next HTML changed", () => {
		expect(shouldReplacePreviewFragment("<p>Hello</p>", "<p>Hello world</p>")).toBe(true);
	});

	it("writes the new HTML without resetting the scroll position", () => {
		const previewEl = {
			innerHTML: "<p>old</p>",
			scrollTop: 240
		};

		replacePreviewFragment(previewEl, "<p>new</p>");

		expect(previewEl.innerHTML).toBe("<p>new</p>");
		expect(previewEl.scrollTop).toBe(240);
	});
});
