import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const xMarkdownTools = require("../../chrome-companion/src/page-x-markdown.js") as {
	markdownToDraftBlocks: (markdown: string) => Array<{ type: string; text: string }>;
};

describe("X Chrome companion Markdown formatting", () => {
	it("maps Markdown headings to X Draft.js heading blocks", () => {
		expect(xMarkdownTools.markdownToDraftBlocks("## C# 跨会话衔接 ##\n\n### 用 @ 或会话 ID")).toEqual([
			{ type: "header-two", text: "C# 跨会话衔接" },
			{ type: "header-three", text: "用 @ 或会话 ID" }
		]);
	});

	it("omits blank editor blocks and keeps each paragraph compact", () => {
		expect(xMarkdownTools.markdownToDraftBlocks("第一段第一行\n第一段第二行\n\n\n第二段")).toEqual([
			{ type: "unstyled", text: "第一段第一行 第一段第二行" },
			{ type: "unstyled", text: "第二段" }
		]);
	});

	it("keeps image markers in their own blocks for image placement", () => {
		expect(xMarkdownTools.markdownToDraftBlocks("开头\n\n[[OTP_IMAGE_asset_1_1]]\n\n结尾")).toEqual([
			{ type: "unstyled", text: "开头" },
			{ type: "unstyled", text: "[[OTP_IMAGE_asset_1_1]]" },
			{ type: "unstyled", text: "结尾" }
		]);
	});
});
