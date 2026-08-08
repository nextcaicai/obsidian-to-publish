import { describe, expect, it } from "vitest";

import {
	ensurePrimaryInSelectedPlatforms,
	formatSelectedPlatformsLabel,
	normalizeSelectedPlatforms,
	resolvePrimaryPlatform,
	togglePlatformSelection
} from "../src/platforms/selection";

describe("platform selection", () => {
	it("normalizes invalid multi-select values to a fallback platform", () => {
		expect(normalizeSelectedPlatforms(undefined, "wechat")).toEqual(["wechat"]);
		expect(normalizeSelectedPlatforms(["wechat", "nope", "wechat", "bilibili"], "zhihu")).toEqual([
			"wechat",
			"bilibili"
		]);
	});

	it("keeps the primary platform inside the selected list", () => {
		expect(ensurePrimaryInSelectedPlatforms(["csdn", "juejin"], "wechat")).toEqual([
			"wechat",
			"csdn",
			"juejin"
		]);
		expect(ensurePrimaryInSelectedPlatforms(["csdn", "juejin"], "juejin")).toEqual([
			"csdn",
			"juejin"
		]);
	});

	it("resolves primary platform to the first selected when preferred is missing", () => {
		expect(resolvePrimaryPlatform(["x", "bilibili"], "wechat")).toBe("x");
		expect(resolvePrimaryPlatform(["x", "bilibili"], "bilibili")).toBe("bilibili");
	});

	it("formats multi-select labels with a +N suffix", () => {
		expect(formatSelectedPlatformsLabel(["wechat"], "wechat")).toBe("微信公众号");
		expect(formatSelectedPlatformsLabel(["wechat", "bilibili", "x"], "wechat")).toBe("微信公众号 +2");
		expect(formatSelectedPlatformsLabel(["wechat", "bilibili", "x"], "bilibili")).toBe("Bilibili 图文 +2");
	});

	it("toggles multi-select while protecting the last remaining platform", () => {
		const uncheckedOnly = togglePlatformSelection(["wechat"], "wechat", false, "wechat");
		expect(uncheckedOnly.selectedPlatforms).toEqual(["wechat"]);
		expect(uncheckedOnly.primaryPlatform).toBe("wechat");

		const checked = togglePlatformSelection(["wechat"], "bilibili", true, "wechat");
		expect(checked.selectedPlatforms).toEqual(["wechat", "bilibili"]);
		expect(checked.primaryPlatform).toBe("bilibili");

		const uncheckedPrimary = togglePlatformSelection(
			["wechat", "bilibili"],
			"bilibili",
			false,
			"bilibili"
		);
		expect(uncheckedPrimary.selectedPlatforms).toEqual(["wechat"]);
		expect(uncheckedPrimary.primaryPlatform).toBe("wechat");
	});
});
