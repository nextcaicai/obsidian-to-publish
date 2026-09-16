import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const substackAdapterPath = require.resolve("../../chrome-companion/src/platforms/substack.js");

type SubstackAdapter = {
	matchesUrl(url: string): boolean;
	getPageMode(url: string): "dashboard" | "editor" | "invalid";
	getEditorReadiness(): { ready: boolean; terminal: boolean; reason: string };
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
		vi.useRealTimers();
		delete (globalThis as Record<string, unknown>).OTPCompanion;
		delete (globalThis as Record<string, unknown>).window;
		delete (globalThis as Record<string, unknown>).document;
		delete (globalThis as Record<string, unknown>).HTMLElement;
		delete (globalThis as Record<string, unknown>).MouseEvent;
		delete (globalThis as Record<string, unknown>).PointerEvent;
		delete require.cache[substackAdapterPath];
	});

	it("accepts personal dashboard plus legacy and current draft-specific editor URLs", () => {
		expect(adapter.matchesUrl("https://nextcaicai.substack.com/publish/home")).toBe(true);
		expect(adapter.matchesUrl("https://nextcaicai.substack.com/publish/post/12345")).toBe(true);
		expect(adapter.matchesUrl("https://nextcaicai.substack.com/publish/posts/12345")).toBe(true);
		expect(adapter.matchesUrl("https://nextcaicai.substack.com/publish/post")).toBe(false);
		expect(adapter.matchesUrl("https://nextcaicai.substack.com/publish/posts/drafts")).toBe(false);
		expect(adapter.matchesUrl("https://substack.com/publish/post")).toBe(false);
	});

	it("keeps dashboard navigation distinct from a writable editor and uses exact Create then Article actions", () => {
		expect(adapter.getPageMode("https://nextcaicai.substack.com/publish/home")).toBe("dashboard");
		expect(adapter.getPageMode("https://nextcaicai.substack.com/publish/post/12345")).toBe("editor");
		expect(adapter.getPageMode("https://nextcaicai.substack.com/publish/posts/12345")).toBe("editor");
		expect(adapter.createActionLabels).toEqual(["Create", "新建"]);
		expect(adapter.articleActionLabels).toEqual(["Article", "文章"]);
	});

	it("accepts the current editor's generic contenteditable body after finding its title", () => {
		const title = { id: "title" };
		const body = { id: "body" };
		(globalThis as Record<string, unknown>).window = {
			location: { href: "https://nextcaicai.substack.com/publish/posts/12345" }
		};
		(globalThis as Record<string, unknown>).document = {
			querySelector: () => title,
			querySelectorAll: () => [title, body]
		};

		expect(adapter.getEditorReadiness()).toEqual({ ready: true, terminal: false, reason: "" });
	});

	it("clicks Create before an Article action rendered as a non-semantic menu container", async () => {
		vi.useFakeTimers();
		const activations: string[] = [];
		let phase: "create" | "article" = "create";
		class FakeEvent {
			constructor(public type: string) {}
		}
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

			click(): void {}

			dispatchEvent(event: FakeEvent): boolean {
				if (this.textContent === "Create" && event.type === "pointerdown") {
					activations.push("Create");
					phase = "article";
				}
				if (this.textContent === "Article" && event.type === "click") {
					activations.push("Article");
				}
				return true;
			}

			focus(): void {}

			scrollIntoView(): void {}
		}

		const createControl = new FakeElement("Create");
		const articleContainer = new FakeElement("Article");
		(globalThis as Record<string, unknown>).HTMLElement = FakeElement;
		(globalThis as Record<string, unknown>).MouseEvent = FakeEvent;
		(globalThis as Record<string, unknown>).PointerEvent = FakeEvent;
		(globalThis as Record<string, unknown>).window = {
			location: { href: "https://nextcaicai.substack.com/publish/home" },
			getComputedStyle: () => ({ display: "block", visibility: "visible" })
		};
		(globalThis as Record<string, unknown>).document = {
			querySelectorAll: (selector: string) => {
				if (phase === "create") {
					return selector.startsWith("button") ? [createControl] : [];
				}
				if (selector.startsWith("button")) {
					return [];
				}
				return selector === "body *" ? [articleContainer] : [];
			}
		};

		const preparation = adapter.prepareEditor();
		await vi.advanceTimersByTimeAsync(5100);
		await expect(preparation).resolves.toMatchObject({
			ready: false,
			terminal: false,
			reason: "substack_creating_article"
		});
		expect(activations).toEqual(["Create", "Article"]);
	});
});
