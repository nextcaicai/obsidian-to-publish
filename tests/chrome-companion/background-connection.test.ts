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
		bridgeToken: "expected-token"
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
				}
			},
			onChanged: { addListener }
		},
		tabs: {
			onRemoved: { addListener },
			onUpdated: { addListener },
			sendMessage: async () => undefined
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

	afterEach(() => {
		const api = (globalThis as {
			OTPCompanionBackground?: { closeBridge(): void };
		}).OTPCompanionBackground;
		api?.closeBridge();
		delete (globalThis as Record<string, unknown>).OTPCompanionBackground;
		delete (globalThis as Record<string, unknown>).__OTP_COMPANION_BACKGROUND_TEST__;
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
});
