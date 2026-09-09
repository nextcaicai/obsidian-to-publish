import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const xMarkdownTools = require("../../chrome-companion/src/page-x-markdown.js") as {
	markdownToDraftBlocks: (markdown: string) => Array<{
		type: string;
		text: string;
		inlineStyleRanges?: Array<{ offset: number; length: number; style: string }>;
	}>;
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

	it("converts bold Markdown to Draft.js BOLD character ranges", () => {
		expect(xMarkdownTools.markdownToDraftBlocks("正文 **需要加粗**，还有 __也需要加粗__。")).toEqual([
			{
				type: "unstyled",
				text: "正文 需要加粗，还有 也需要加粗。",
				inlineStyleRanges: [
					{ offset: 3, length: 4, style: "BOLD" },
					{ offset: 11, length: 5, style: "BOLD" }
				]
			}
		]);
	});
});
