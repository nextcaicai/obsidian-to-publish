import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const adapterPath = require.resolve("../../chrome-companion/src/platforms/zhihu.js");

describe("Zhihu Chrome companion adapter", () => {
	afterEach(() => {
		delete (globalThis as { OTPCompanion?: unknown }).OTPCompanion;
		delete require.cache[adapterPath];
	});

	it("uploads local images through markers and the article image input", () => {
		let registeredAdapter: Record<string, unknown> | null = null;
		(globalThis as { OTPCompanion?: unknown }).OTPCompanion = {
			registerPlatformAdapter(adapter: Record<string, unknown>) {
				registeredAdapter = adapter;
			}
		};

		delete require.cache[adapterPath];
		require(adapterPath);

		expect(registeredAdapter).toMatchObject({
			id: "zhihu",
			bodyFormat: "rich-html",
			insertMode: "rich-html-placeholder-assets",
			includeFilesInMainPaste: false,
			uploadImagesViaFileInput: true
		});
	});
});
