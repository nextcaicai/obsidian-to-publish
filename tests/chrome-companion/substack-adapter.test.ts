import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const substackAdapterPath = require.resolve("../../chrome-companion/src/platforms/substack.js");

type SubstackAdapter = {
	matchesUrl(url: string): boolean;
	getPageMode(url: string): "dashboard" | "editor" | "invalid";
	prepareEditor(): Promise<{ ready: boolean; terminal: boolean; reason: string }>;
	createActionLabels: string[];
	articleActionLabels: string[];
};

describe("Substack companion adapter", () => {
	let adapter: SubstackAdapter;

	beforeEach(() => {
		(globalThis as Record<string, unknown>).OTPCompanion = {
			registerPlatformAdapter(candidate: SubstackAdapter) {
				adapter = candidate;
			}
		};
		delete require.cache[substackAdapterPath];
		require(substackAdapterPath);
	});

	afterEach(() => {
		delete (globalThis as Record<string, unknown>).OTPCompanion;
		delete (globalThis as Record<string, unknown>).window;
		delete (globalThis as Record<string, unknown>).document;
		delete (globalThis as Record<string, unknown>).HTMLElement;
		delete require.cache[substackAdapterPath];
	});

	it("accepts only a personal dashboard or a draft-specific editor URL", () => {
		expect(adapter.matchesUrl("https://nextcaicai.substack.com/publish/home")).toBe(true);
		expect(adapter.matchesUrl("https://nextcaicai.substack.com/publish/post/12345")).toBe(true);
		expect(adapter.matchesUrl("https://nextcaicai.substack.com/publish/post")).toBe(false);
		expect(adapter.matchesUrl("https://substack.com/publish/post")).toBe(false);
	});

	it("keeps dashboard navigation distinct from a writable editor and uses exact Create then Article actions", () => {
		expect(adapter.getPageMode("https://nextcaicai.substack.com/publish/home")).toBe("dashboard");
		expect(adapter.getPageMode("https://nextcaicai.substack.com/publish/post/12345")).toBe("editor");
		expect(adapter.createActionLabels).toEqual(["Create", "新建"]);
		expect(adapter.articleActionLabels).toEqual(["Article", "文章"]);
	});

	it("clicks the visible Create action before the visible Article action", async () => {
		const clicks: string[] = [];
		let controls: FakeElement[] = [];
		class FakeElement {
			hidden = false;

			constructor(public textContent: string) {}

			getAttribute(name: string): string | null {
				return name === "aria-hidden" || name === "aria-disabled" ? "false" : null;
			}

			hasAttribute(): boolean {
				return false;
			}

			getClientRects(): Array<Record<string, never>> {
				return [{}];
			}

			click(): void {
				clicks.push(this.textContent);
				if (this.textContent === "Create") {
					controls = [new FakeElement("Article")];
				}
			}
		}

		controls = [new FakeElement("Create")];
		(globalThis as Record<string, unknown>).HTMLElement = FakeElement;
		(globalThis as Record<string, unknown>).window = {
			location: { href: "https://nextcaicai.substack.com/publish/home" },
			getComputedStyle: () => ({ display: "block", visibility: "visible" })
		};
		(globalThis as Record<string, unknown>).document = {
			querySelectorAll: () => controls
		};

		await expect(adapter.prepareEditor()).resolves.toMatchObject({
			ready: false,
			terminal: false,
			reason: "substack_creating_article"
		});
		expect(clicks).toEqual(["Create", "Article"]);
	});
});
