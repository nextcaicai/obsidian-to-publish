import { describe, expect, it } from "vitest";

import {
	isCopyPlatform,
	PLATFORM_PROFILE_LIST,
	PLATFORM_PROFILES
} from "../src/platforms/profiles";

describe("platform profiles", () => {
	it("keeps the first supported platform batch in a stable order", () => {
		expect(PLATFORM_PROFILE_LIST.map((profile) => profile.id)).toEqual([
			"wechat",
			"zhishixingqiu",
			"zhihu",
			"csdn",
			"juejin",
			"substack",
			"x",
			"xiaohongshu",
			"bilibili"
		]);
	});

	it("declares a safe editor URL and output format for every platform", () => {
		for (const profile of PLATFORM_PROFILE_LIST) {
			expect(profile.editorUrl).toMatch(/^https:\/\//);
			expect(["rich-html", "markdown", "plain-text"]).toContain(profile.preferredFormat);
			expect(profile.label.length).toBeGreaterThan(0);
			expect(profile.copyLabel.length).toBeGreaterThan(0);
		}
	});

	it("records markdown-first and text-first platforms explicitly", () => {
		expect(PLATFORM_PROFILES.csdn.preferredFormat).toBe("markdown");
		expect(PLATFORM_PROFILES.juejin.preferredFormat).toBe("markdown");
		expect(PLATFORM_PROFILES.juejin.capabilities.supportsRichHtml).toBe(true);
		expect(PLATFORM_PROFILES.x.preferredFormat).toBe("markdown");
		expect(PLATFORM_PROFILES.xiaohongshu.preferredFormat).toBe("plain-text");
		expect(PLATFORM_PROFILES.zhihu.preferredFormat).toBe("rich-html");
	});

	it("opens the X Articles editor with a markdown-first profile", () => {
		expect(PLATFORM_PROFILES.x.label).toBe("X Articles");
		expect(PLATFORM_PROFILES.x.copyLabel).toBe("X Articles");
		expect(PLATFORM_PROFILES.x.editorUrl).toBe("https://x.com/compose/articles");
		expect(PLATFORM_PROFILES.x.capabilities.supportsMarkdown).toBe(true);
	});

	it("marks platforms that require remote image URLs", () => {
		expect(PLATFORM_PROFILES.zhihu.capabilities.requiresRemoteImageUrl).toBe(true);
		expect(PLATFORM_PROFILES.juejin.capabilities.requiresRemoteImageUrl).toBe(true);
		expect(PLATFORM_PROFILES.wechat.capabilities.requiresRemoteImageUrl).toBe(false);
	});

	it("uses the Chinese label for WeChat official account", () => {
		expect(PLATFORM_PROFILES.wechat.label).toBe("微信公众号");
		expect(PLATFORM_PROFILES.wechat.copyLabel).toBe("微信公众号");
	});

	it("keeps bold text at the normal body size for Zhishixingqiu", () => {
		const strongRule = PLATFORM_PROFILES.zhishixingqiu.rules.find(
			(rule) => rule.selector === "strong"
		);

		expect(strongRule?.style).toContain("font-size:16px");
		expect(strongRule?.style).toContain("font-weight:700");
	});

	it("keeps ordered list text at the normal body size for Zhishixingqiu", () => {
		const listRule = PLATFORM_PROFILES.zhishixingqiu.rules.find(
			(rule) => rule.selector === "ul,ol"
		);
		const listItemRule = PLATFORM_PROFILES.zhishixingqiu.rules.find(
			(rule) => rule.selector === "li"
		);

		expect(listRule?.style).toContain("font-size:16px");
		expect(listItemRule?.style).toContain("font-size:16px");
	});

	it("keeps link text at the normal body size for Zhishixingqiu", () => {
		const linkRule = PLATFORM_PROFILES.zhishixingqiu.rules.find(
			(rule) => rule.selector === "a"
		);

		expect(linkRule?.style).toContain("font-size:16px");
		expect(linkRule?.style).toContain("text-decoration:none");
	});

	it("accepts known platform ids and rejects unknown values", () => {
		expect(isCopyPlatform("wechat")).toBe(true);
		expect(isCopyPlatform("bilibili")).toBe(true);
		expect(isCopyPlatform("unknown")).toBe(false);
		expect(isCopyPlatform("__proto__")).toBe(false);
	});
});
