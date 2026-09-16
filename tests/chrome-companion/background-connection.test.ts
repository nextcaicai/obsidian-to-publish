import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const backgroundPath = require.resolve("../../chrome-companion/src/background.js");

type Listener = (...args: unknown[]) => void;

class FakeWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readonly listeners = new Map<string, Listener[]>();
	readonly sent: string[] = [];
	readyState = FakeWebSocket.CONNECTING;

	constructor(readonly url: string) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(event: string, listener: Listener) {
		const listeners = this.listeners.get(event) || [];
		listeners.push(listener);
		this.listeners.set(event, listeners);
	}

	close() {
		this.readyState = FakeWebSocket.CLOSED;
	}

	send(message: string) {
		this.sent.push(message);
	}

	open() {
		this.readyState = FakeWebSocket.OPEN;
		this.emit("open");
	}

	closeFromNetwork() {
		this.readyState = FakeWebSocket.CLOSED;
		this.emit("close");
	}

	private emit(event: string, payload: unknown = {}) {
		for (const listener of this.listeners.get(event) || []) {
			listener(payload);
		}
	}
}

function installChromeMock() {
	const addListener = () => undefined;
	const storage = {
		bridgePort: 27127,
		bridgeToken: "expected-token",
		substackEditorUrl: ""
	};
	const createdTabs: Array<Record<string, unknown>> = [];
	const queryTabs: Array<Record<string, unknown>> = [];
	const focusedWindows: Array<{ windowId: number; focused: boolean }> = [];
	(globalThis as Record<string, unknown>).__OTP_CHROME_MOCK_STATE__ = {
		createdTabs,
		focusedWindows,
		queryTabs,
		storage
	};

	(globalThis as Record<string, unknown>).chrome = {
		action: {
			onClicked: { addListener }
		},
		runtime: {
			getManifest: () => ({ version: "0.1.0" }),
			onInstalled: { addListener },
			onMessage: { addListener },
			onStartup: { addListener },
			openOptionsPage: () => undefined
		},
		storage: {
			local: {
				get: async (defaults: Record<string, unknown>) => ({
					...defaults,
					...storage
				}),
				set: async (values: Record<string, unknown>) => {
					Object.assign(storage, values);
				},
				remove: async (keys: string | string[]) => {
					for (const key of Array.isArray(keys) ? keys : [keys]) {
						delete storage[key as keyof typeof storage];
					}
				}
			},
			onChanged: { addListener }
		},
		tabs: {
			create: async (createInfo: Record<string, unknown>) => {
				const tab = {
					...createInfo,
					id: createdTabs.length + 1,
					windowId: 1
				};
				createdTabs.push(tab);
				return tab;
			},
			onRemoved: { addListener },
			onUpdated: { addListener },
			query: async () => queryTabs,
			sendMessage: async () => undefined
		},
		windows: {
			update: async (windowId: number, updateInfo: { focused?: boolean }) => {
				focusedWindows.push({
					windowId,
					focused: updateInfo.focused === true
				});
			}
		}
	};
}

describe("Chrome companion background connection", () => {
	beforeEach(() => {
		FakeWebSocket.instances = [];
		(globalThis as Record<string, unknown>).__OTP_COMPANION_BACKGROUND_TEST__ = true;
		(globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;
		installChromeMock();
		delete require.cache[backgroundPath];
	});

	afterEach(async () => {
		const api = (globalThis as {
			OTPCompanionBackground?: {
				clearTask(): Promise<void>;
				closeBridge(): void;
			};
		}).OTPCompanionBackground;
		await api?.clearTask();
		api?.closeBridge();
		delete (globalThis as Record<string, unknown>).OTPCompanionBackground;
		delete (globalThis as Record<string, unknown>).__OTP_COMPANION_BACKGROUND_TEST__;
		delete (globalThis as Record<string, unknown>).__OTP_CHROME_MOCK_STATE__;
		delete (globalThis as Record<string, unknown>).chrome;
		delete require.cache[backgroundPath];
	});

	it("ignores close events from a replaced socket after the new socket opens", async () => {
		require(backgroundPath);
		const api = (globalThis as {
			OTPCompanionBackground: {
				closeBridge(): void;
				connectBridge(): Promise<void>;
				getConnectionState(): {
					connected: boolean;
					connecting: boolean;
					lastError: string;
				};
			};
		}).OTPCompanionBackground;

		await api.connectBridge();
		const staleSocket = FakeWebSocket.instances[0];
		api.closeBridge();

		await api.connectBridge();
		const currentSocket = FakeWebSocket.instances[1];
		currentSocket.open();
		staleSocket.closeFromNetwork();

		expect(api.getConnectionState()).toMatchObject({
			connected: true,
			connecting: false,
			lastError: ""
		});
		expect(FakeWebSocket.instances).toHaveLength(2);
	});

	it("does not open another socket while the current socket is connecting", async () => {
		require(backgroundPath);
		const api = (globalThis as {
			OTPCompanionBackground: {
				connectBridge(): Promise<void>;
				getConnectionState(): {
					connected: boolean;
					connecting: boolean;
				};
			};
		}).OTPCompanionBackground;

		await api.connectBridge();
		await api.connectBridge();

		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(api.getConnectionState()).toMatchObject({
			connected: false,
			connecting: true
		});
	});

	it("opens the remembered personal Substack dashboard for Substack imports", async () => {
		require(backgroundPath);
		const state = (globalThis as {
			__OTP_CHROME_MOCK_STATE__: {
				createdTabs: Array<{ url?: string }>;
				focusedWindows: Array<{ windowId: number; focused: boolean }>;
				storage: { substackEditorUrl: string };
			};
		}).__OTP_CHROME_MOCK_STATE__;
		const api = (globalThis as {
			OTPCompanionBackground: {
				importDraft(params: unknown): Promise<unknown>;
			};
		}).OTPCompanionBackground;
		state.storage.substackEditorUrl = "https://nextcaicai.substack.com/publish/post/";

		await api.importDraft({
			package: {
				version: 1,
				source: "obsidian-to-publish",
				requestId: "pub_substack",
				targets: ["substack"]
			}
		});

		expect(state.createdTabs[0].url).toBe("https://nextcaicai.substack.com/publish/home");
		expect(state.focusedWindows).toEqual([{ windowId: 1, focused: true }]);
	});

	it("detects a personal Substack publication from an open publisher home tab", async () => {
		require(backgroundPath);
		const state = (globalThis as {
			__OTP_CHROME_MOCK_STATE__: {
				createdTabs: Array<{ url?: string }>;
				queryTabs: Array<{ url?: string }>;
				storage: { substackEditorUrl: string };
			};
		}).__OTP_CHROME_MOCK_STATE__;
		const api = (globalThis as {
			OTPCompanionBackground: {
				importDraft(params: unknown): Promise<unknown>;
			};
		}).OTPCompanionBackground;
		state.queryTabs.push({
			url: "https://nextcaicai.substack.com/publish/home"
		});

		await api.importDraft({
			package: {
				version: 1,
				source: "obsidian-to-publish",
				requestId: "pub_substack_home",
				targets: ["substack"]
			}
		});

		expect(state.storage.substackEditorUrl)
			.toBe("https://nextcaicai.substack.com/publish/home");
		expect(state.createdTabs[0].url)
			.toBe("https://nextcaicai.substack.com/publish/home");
	});

	it("does not open the public Substack discovery page when no publication is known", async () => {
		require(backgroundPath);
		const state = (globalThis as {
			__OTP_CHROME_MOCK_STATE__: {
				createdTabs: Array<{ url?: string }>;
			};
		}).__OTP_CHROME_MOCK_STATE__;
		const api = (globalThis as {
			OTPCompanionBackground: {
				importDraft(params: unknown): Promise<unknown>;
			};
		}).OTPCompanionBackground;

		await expect(api.importDraft({
			package: {
				version: 1,
				source: "obsidian-to-publish",
				requestId: "pub_substack_unknown",
				targets: ["substack"]
			}
		})).rejects.toThrow("substack_publisher_not_found");
		expect(state.createdTabs).toHaveLength(0);
	});

	it("refuses to guess between multiple inactive personal publications", async () => {
		require(backgroundPath);
		const state = (globalThis as {
			__OTP_CHROME_MOCK_STATE__: {
				createdTabs: Array<{ url?: string }>;
				queryTabs: Array<{ url?: string; active?: boolean; lastAccessed?: number }>;
			};
		}).__OTP_CHROME_MOCK_STATE__;
		const api = (globalThis as {
			OTPCompanionBackground: {
				importDraft(params: unknown): Promise<unknown>;
			};
		}).OTPCompanionBackground;
		state.queryTabs.push(
			{ url: "https://first.substack.com/publish/home", lastAccessed: 20 },
			{ url: "https://second.substack.com/publish/home", lastAccessed: 10 }
		);

		await expect(api.importDraft({
			package: {
				version: 1,
				source: "obsidian-to-publish",
				requestId: "pub_substack_ambiguous",
				targets: ["substack"]
			}
		})).rejects.toThrow("substack_publication_ambiguous");
		expect(state.createdTabs).toHaveLength(0);
	});

	it("fails and clears the remembered publisher when a Substack task redirects to the public root", async () => {
		require(backgroundPath);
		const state = (globalThis as {
			__OTP_CHROME_MOCK_STATE__: {
				storage: { substackEditorUrl?: string };
			};
		}).__OTP_CHROME_MOCK_STATE__;
		const api = (globalThis as {
			OTPCompanionBackground: {
				importDraft(params: unknown): Promise<{
					accepted: boolean;
					taskId: string;
					status: string;
					reason?: string;
				}>;
				handleSubstackTaskNavigation(taskId: string, url: string): Promise<boolean>;
			};
		}).OTPCompanionBackground;
		state.storage.substackEditorUrl = "https://nextcaicai.substack.com/publish/home";

		const receipt = api.importDraft({
			awaitReceipt: true,
			package: {
				version: 1,
				source: "obsidian-to-publish",
				requestId: "pub_substack_root_redirect",
				targets: ["substack"]
			}
		});
		for (let index = 0; index < 8; index += 1) {
			await Promise.resolve();
		}
		await expect(api.handleSubstackTaskNavigation(
			"pub_substack_root_redirect",
			"https://substack.com/publish/post"
		)).resolves.toBe(false);

		await expect(receipt).resolves.toMatchObject({
			accepted: false,
			status: "failed",
			reason: "substack_redirected_to_public_site"
		});
		expect(state.storage.substackEditorUrl).toBeUndefined();
	});

	it("keeps a Substack task active when the current plural editor route loads", async () => {
		require(backgroundPath);
		const state = (globalThis as {
			__OTP_CHROME_MOCK_STATE__: {
				storage: { substackEditorUrl?: string };
			};
		}).__OTP_CHROME_MOCK_STATE__;
		const api = (globalThis as {
			OTPCompanionBackground: {
				importDraft(params: unknown): Promise<unknown>;
				handleSubstackTaskNavigation(taskId: string, url: string): Promise<boolean>;
			};
		}).OTPCompanionBackground;
		state.storage.substackEditorUrl = "https://nextcaicai.substack.com/publish/home";

		await api.importDraft({
			package: {
				version: 1,
				source: "obsidian-to-publish",
				requestId: "pub_substack_plural_editor",
				targets: ["substack"]
			}
		});
		for (let index = 0; index < 8; index += 1) {
			await Promise.resolve();
		}

		await expect(api.handleSubstackTaskNavigation(
			"pub_substack_plural_editor",
			"https://nextcaicai.substack.com/publish/posts/12345"
		)).resolves.toBe(true);
	});

	it("normalizes pasted personal Substack URLs", () => {
		require(backgroundPath);
		const api = (globalThis as {
			OTPCompanionBackground: {
				normalizeSubstackEditorUrl(value: string): string;
			};
		}).OTPCompanionBackground;

		expect(api.normalizeSubstackEditorUrl("https://nextcaicai.substack.com/publish/post，"))
			.toBe("https://nextcaicai.substack.com/publish/home");
		expect(api.normalizeSubstackEditorUrl("https://nextcaicai.substack.com/publish/home"))
			.toBe("https://nextcaicai.substack.com/publish/home");
		expect(api.normalizeSubstackEditorUrl("https://substack.com/publish/post"))
			.toBe("");
		expect(api.normalizeSubstackEditorUrl("https://example.com/publish/post"))
			.toBe("");
	});
});
