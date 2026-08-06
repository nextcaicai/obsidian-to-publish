import { describe, expect, it, vi } from "vitest";

import { sendToChromeCompanionAndActivate } from "../src/publishing/chrome-delivery";

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
});
