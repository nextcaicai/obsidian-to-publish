import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const uploadPath = require.resolve("../../chrome-companion/src/page-x-upload.js");

type XUploadTools = {
	findEditorElement(): unknown;
};

describe("X Articles page upload editor discovery", () => {
	afterEach(() => {
		delete (globalThis as Record<string, unknown>).window;
		delete (globalThis as Record<string, unknown>).document;
		delete (globalThis as Record<string, unknown>).OTPXUpload;
		delete require.cache[uploadPath];
	});

	it("accepts the short empty body editor rendered by a new X Article", () => {
		const body = {
			getBoundingClientRect: () => ({ width: 900, height: 28 })
		};
		(globalThis as Record<string, unknown>).window = {
			addEventListener: () => undefined
		};
		(globalThis as Record<string, unknown>).document = {
			querySelectorAll: () => [body]
		};

		const tools = require(uploadPath) as XUploadTools;
		expect(tools.findEditorElement()).toBe(body);
	});

	it("prefers the article body over the earlier title field", () => {
		const title = {
			getAttribute: (name: string) => name === "aria-label" ? "Add a title" : null,
			getBoundingClientRect: () => ({ width: 900, height: 72 })
		};
		const body = {
			getAttribute: () => null,
			getBoundingClientRect: () => ({ width: 900, height: 28 })
		};
		(globalThis as Record<string, unknown>).window = {
			addEventListener: () => undefined
		};
		(globalThis as Record<string, unknown>).document = {
			querySelectorAll: () => [title, body]
		};

		const tools = require(uploadPath) as XUploadTools;
		expect(tools.findEditorElement()).toBe(body);
	});
});
