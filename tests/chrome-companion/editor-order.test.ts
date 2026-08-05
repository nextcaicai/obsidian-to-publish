import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const orderTools = require("../../chrome-companion/src/page-editor-order.js") as {
	buildReplacementOrder: (
		blockKeys: string[],
		replacements: Array<{ markerKey: string; mediaKey: string; preserveMarker?: boolean }>
	) => string[];
};
const proseMirrorTools = require("../../chrome-companion/src/page-prosemirror-core.js") as {
	captureImageFingerprintCounts: (doc: FakeDoc) => Map<string, number>;
	findNewImageBlock: (
		doc: FakeDoc,
		beforeCounts: Map<string, number>
	) => { index: number; fingerprint: string; occurrence: number } | null;
	findNewImageBlocks: (
		doc: FakeDoc,
		beforeCounts: Map<string, number>
	) => Array<{ index: number; pos: number; fingerprint: string; occurrence: number }>;
	buildImageDeduplicationPlan: (
		imageBlocks: Array<{ index: number; pos: number }>,
		markerPos: number
	) => { keep: { index: number; pos: number } | null; remove: Array<{ index: number; pos: number }> };
};

type FakeNode = {
	type: { name: string };
	attrs: Record<string, unknown>;
	textContent: string;
	descendants: (visit: (node: FakeNode) => boolean | void) => void;
};

type FakeDoc = {
	forEach: (visit: (node: FakeNode, pos: number, index: number) => void) => void;
};

function imageBlock(src: string): FakeNode {
	const image: FakeNode = {
		type: { name: "image" },
		attrs: { src },
		textContent: "",
		descendants: () => undefined
	};
	return {
		type: { name: "paragraph" },
		attrs: {},
		textContent: "",
		descendants: (visit) => {
			visit(image);
		}
	};
}

function imageDoc(sources: string[]): FakeDoc {
	const blocks = sources.map(imageBlock);
	return {
		forEach: (visit) => blocks.forEach((block, index) => visit(block, index * 2, index))
	};
}

describe("Chrome companion editor block ordering", () => {
	it("replaces every X marker with its own uploaded media block in one batch", () => {
		const result = orderTools.buildReplacementOrder(
			["intro", "marker-1", "middle", "marker-2", "end", "media-1", "media-2"],
			[
				{ markerKey: "marker-1", mediaKey: "media-1" },
				{ markerKey: "marker-2", mediaKey: "media-2" }
			]
		);

		expect(result).toEqual(["intro", "media-1", "middle", "media-2", "end"]);
	});

	it("keeps a cleaned marker block after media when the marker was embedded in text", () => {
		const result = orderTools.buildReplacementOrder(
			["intro", "marker", "end", "media"],
			[{ markerKey: "marker", mediaKey: "media", preserveMarker: true }]
		);

		expect(result).toEqual(["intro", "media", "marker", "end"]);
	});

	it("finds the new Bilibili image even when existing ProseMirror nodes are recreated", () => {
		const before = proseMirrorTools.captureImageFingerprintCounts(imageDoc(["data:image/a", "data:image/b"]));
		const added = proseMirrorTools.findNewImageBlock(
			imageDoc(["data:image/a", "data:image/new", "data:image/b"]),
			before
		);

		expect(added?.index).toBe(1);
	});

	it("uses fingerprint multiplicity when the new image has the same source", () => {
		const before = proseMirrorTools.captureImageFingerprintCounts(imageDoc(["data:image/repeated"]));
		const added = proseMirrorTools.findNewImageBlock(
			imageDoc(["data:image/repeated", "data:image/repeated"]),
			before
		);

		expect(added?.index).toBe(1);
		expect(added?.occurrence).toBe(2);
	});

	it("removes the extra Xiaohongshu image created by one file paste", () => {
		const before = proseMirrorTools.captureImageFingerprintCounts(imageDoc(["data:image/existing"]));
		const added = proseMirrorTools.findNewImageBlocks(
			imageDoc(["data:image/existing", "https://xiaohongshu/upload-a", "https://xiaohongshu/upload-b"]),
			before
		);
		const plan = proseMirrorTools.buildImageDeduplicationPlan(added, 6);

		expect(added.map((entry) => entry.index)).toEqual([1, 2]);
		expect(plan.keep?.index).toBe(2);
		expect(plan.remove.map((entry) => entry.index)).toEqual([1]);
	});
});
