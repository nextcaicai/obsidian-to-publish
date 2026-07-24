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
		expect(PLATFORM_PROFILES.x.preferredFormat).toBe("plain-text");
		expect(PLATFORM_PROFILES.xiaohongshu.preferredFormat).toBe("plain-text");
		expect(PLATFORM_PROFILES.zhihu.preferredFormat).toBe("rich-html");
	});

	it("accepts known platform ids and rejects unknown values", () => {
		expect(isCopyPlatform("wechat")).toBe(true);
		expect(isCopyPlatform("bilibili")).toBe(true);
		expect(isCopyPlatform("unknown")).toBe(false);
		expect(isCopyPlatform("__proto__")).toBe(false);
	});
});
