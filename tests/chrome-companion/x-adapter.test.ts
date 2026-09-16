import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const adapterPath = require.resolve("../../chrome-companion/src/platforms/x.js");

type XAdapter = {
	getEditorReadiness(): { ready: boolean; terminal: boolean; reason: string };
	prepareEditor(): Promise<{ ready: boolean; terminal: boolean; reason: string }>;
	createArticleLabels: string[];
};

describe("X Articles Chrome companion adapter", () => {
	let adapter: XAdapter;

	beforeEach(() => {
		(globalThis as Record<string, unknown>).OTPCompanion = {
			registerPlatformAdapter(candidate: XAdapter) {
				adapter = candidate;
			}
		};
		delete require.cache[adapterPath];
		require(adapterPath);
	});

	afterEach(() => {
		vi.useRealTimers();
		delete (globalThis as Record<string, unknown>).OTPCompanion;
		delete (globalThis as Record<string, unknown>).window;
		delete (globalThis as Record<string, unknown>).document;
		delete (globalThis as Record<string, unknown>).HTMLElement;
		delete (globalThis as Record<string, unknown>).MouseEvent;
		delete (globalThis as Record<string, unknown>).PointerEvent;
		delete require.cache[adapterPath];
	});

	it("treats the articles draft list as an entry page rather than a writable editor", () => {
		(globalThis as Record<string, unknown>).window = {
			location: { href: "https://x.com/compose/articles" }
		};

		expect(adapter.getEditorReadiness()).toEqual({
			ready: false,
			terminal: false,
			reason: "x_drafts_pending"
		});
		expect(adapter.createArticleLabels).toEqual(["Write", "撰写"]);
	});

	it("recognizes a Chinese X Articles title field after the editor opens", () => {
		const selectors: string[] = [];
		(globalThis as Record<string, unknown>).window = {
			location: { href: "https://x.com/i/articles/123" }
		};
		(globalThis as Record<string, unknown>).document = {
			querySelector: (selector: string) => {
				selectors.push(selector);
				return {};
			}
		};

		expect(adapter.getEditorReadiness()).toEqual({ ready: true, terminal: false, reason: "" });
		expect(selectors[0]).toContain("placeholder*='标题'");
	});

	it("clicks the visible Chinese compose action before waiting for the article editor", async () => {
		const activations: string[] = [];
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

			dispatchEvent(event: FakeEvent): boolean {
				if (event.type === "pointerdown") {
					activations.push(this.textContent);
				}
				return true;
			}

			focus(): void {}

			scrollIntoView(): void {}
		}

		const composeButton = new FakeElement("撰写");
		(globalThis as Record<string, unknown>).HTMLElement = FakeElement;
		(globalThis as Record<string, unknown>).MouseEvent = FakeEvent;
		(globalThis as Record<string, unknown>).PointerEvent = FakeEvent;
		(globalThis as Record<string, unknown>).window = {
			location: { href: "https://x.com/compose/articles" },
			getComputedStyle: () => ({ display: "block", visibility: "visible" })
		};
		(globalThis as Record<string, unknown>).document = {
			querySelectorAll: (selector: string) => selector === "button,[role='button'],a" ? [composeButton] : []
		};

		await expect(adapter.prepareEditor()).resolves.toEqual({
			ready: false,
			terminal: false,
			reason: "x_creating_article"
		});
		expect(activations).toEqual(["撰写"]);
	});

	it("clicks the English Write action used by X Articles", async () => {
		const activations: string[] = [];
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

			dispatchEvent(event: FakeEvent): boolean {
				if (event.type === "pointerdown") {
					activations.push(this.textContent);
				}
				return true;
			}

			focus(): void {}

			scrollIntoView(): void {}
		}

		const composeButton = new FakeElement("Write");
		(globalThis as Record<string, unknown>).HTMLElement = FakeElement;
		(globalThis as Record<string, unknown>).MouseEvent = FakeEvent;
		(globalThis as Record<string, unknown>).PointerEvent = FakeEvent;
		(globalThis as Record<string, unknown>).window = {
			location: { href: "https://x.com/compose/articles" },
			getComputedStyle: () => ({ display: "block", visibility: "visible" })
		};
		(globalThis as Record<string, unknown>).document = {
			querySelectorAll: (selector: string) => selector === "button,[role='button'],a" ? [composeButton] : []
		};

		await expect(adapter.prepareEditor()).resolves.toMatchObject({
			ready: false,
			terminal: false,
			reason: "x_creating_article"
		});
		expect(activations).toEqual(["Write"]);
	});

	it("waits for the Write link that X renders after the companion panel", async () => {
		vi.useFakeTimers();
		const activations: string[] = [];
		let writeLinkAvailable = false;
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

			dispatchEvent(event: FakeEvent): boolean {
				if (event.type === "pointerdown") {
					activations.push(this.textContent);
				}
				return true;
			}

			focus(): void {}

			scrollIntoView(): void {}
		}

		const writeLink = new FakeElement("Write");
		(globalThis as Record<string, unknown>).HTMLElement = FakeElement;
		(globalThis as Record<string, unknown>).MouseEvent = FakeEvent;
		(globalThis as Record<string, unknown>).PointerEvent = FakeEvent;
		(globalThis as Record<string, unknown>).window = {
			location: { href: "https://x.com/compose/articles" },
			getComputedStyle: () => ({ display: "block", visibility: "visible" })
		};
		(globalThis as Record<string, unknown>).document = {
			querySelectorAll: (selector: string) => selector === "button,[role='button'],a" && writeLinkAvailable ? [writeLink] : []
		};
		setTimeout(() => {
			writeLinkAvailable = true;
		}, 100);

		const preparation = adapter.prepareEditor();
		await vi.advanceTimersByTimeAsync(200);

		await expect(preparation).resolves.toEqual({
			ready: false,
			terminal: false,
			reason: "x_creating_article"
		});
		expect(activations).toEqual(["Write"]);
	});

	it("stops with a recoverable manual instruction when the compose action is absent", async () => {
		vi.useFakeTimers();
		(globalThis as Record<string, unknown>).HTMLElement = class {};
		(globalThis as Record<string, unknown>).window = {
			location: { href: "https://x.com/compose/articles" },
			getComputedStyle: () => ({ display: "block", visibility: "visible" })
		};
		(globalThis as Record<string, unknown>).document = {
			querySelectorAll: () => []
		};

		const preparation = adapter.prepareEditor();
		await vi.advanceTimersByTimeAsync(8100);

		await expect(preparation).resolves.toMatchObject({
			ready: false,
			terminal: true,
			reason: expect.stringContaining("x_editor_required")
		});
	});
});
