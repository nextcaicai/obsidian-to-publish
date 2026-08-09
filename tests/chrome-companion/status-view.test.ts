import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const statusView = require("../../chrome-companion/src/status-view.js") as {
	getChromeCompanionStateView: (state: {
		connected?: boolean;
		connecting?: boolean;
		lastConnectedAt?: number;
		lastError?: string;
	} | null) => {
		detail: string;
		label: string;
		tone: string;
	};
};

describe("Chrome companion status view", () => {
	it("shows a waiting state only while a connection attempt is active", () => {
		expect(statusView.getChromeCompanionStateView({
			connected: false,
			connecting: true,
			lastError: "",
			lastConnectedAt: 0
		})).toMatchObject({
			label: "连接中",
			tone: "waiting"
		});
	});

	it("shows failed websocket connections as not connected", () => {
		expect(statusView.getChromeCompanionStateView({
			connected: false,
			connecting: false,
			lastError: "websocket_error",
			lastConnectedAt: 0
		})).toMatchObject({
			label: "未连接",
			tone: "offline"
		});
	});
});
