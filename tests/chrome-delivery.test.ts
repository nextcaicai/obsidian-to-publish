import { describe, expect, it, vi } from "vitest";

import {
	getChromeCompanionFallbackAction,
	sendToChromeCompanionAndActivate
} from "../src/publishing/chrome-delivery";

describe("Chrome companion delivery", () => {
	it("activates the external browser after the companion opens the editor tab", async () => {
		const activateBrowser = vi.fn(async () => true);

		const sent = await sendToChromeCompanionAndActivate(
			async () => true,
			activateBrowser
		);

		expect(sent).toBe(true);
		expect(activateBrowser).toHaveBeenCalledOnce();
	});

	it("does not activate the browser when companion delivery fails", async () => {
		const activateBrowser = vi.fn(async () => true);

		const sent = await sendToChromeCompanionAndActivate(
			async () => false,
			activateBrowser
		);

		expect(sent).toBe(false);
		expect(activateBrowser).not.toHaveBeenCalled();
	});

	it("keeps a failed Substack delivery in the clipboard instead of opening its public fallback", () => {
		expect(getChromeCompanionFallbackAction("substack")).toBe("copy-only");
	});

	it("keeps copy-and-open fallback for other Chrome companion platforms", () => {
		expect(getChromeCompanionFallbackAction("zhihu")).toBe("copy-and-open");
	});
});
