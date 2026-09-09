import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const backgroundPath = require.resolve("../../chrome-companion/src/background.js");

type BackgroundApi = {
	clearTask(): Promise<void>;
	getSchedulerSnapshot(): {
		activeTaskIdsByPlatform: Record<string, string>;
		queuedTaskIdsByPlatform: Record<string, string[]>;
		tasks: Array<{ id: string; platform: string; status: string; tabId: number | null }>;
	};
	handleTaskResult(
		message: { taskId: string; platform: string; status: string; reason?: string },
		sender: { tab: { id: number } }
	): Promise<{ ok: boolean; error?: string }>;
	handleTabRemoved(tabId: number): Promise<void>;
	importDraft(params: unknown): Promise<{ accepted: boolean; taskId: string; platform: string; status: string }>;
};

function installChromeMock() {
	const storage: Record<string, unknown> = {
		bridgePort: 27127,
		bridgeToken: "expected-token",
		substackEditorUrl: ""
	};
	const createdTabs: Array<Record<string, unknown>> = [];
	const state = {
		createdTabs,
		storage,
		setInterceptor: null as null | ((values: Record<string, unknown>) => Promise<void> | void),
		throwNextRemove: false
	};
	(globalThis as Record<string, unknown>).__OTP_CHROME_MOCK_STATE__ = state;

	const addListener = () => undefined;
	(globalThis as Record<string, unknown>).chrome = {
		action: { onClicked: { addListener } },
		runtime: {
			getManifest: () => ({ version: "0.1.0" }),
			onInstalled: { addListener },
			onMessage: { addListener },
			onStartup: { addListener },
			openOptionsPage: () => undefined
		},
		storage: {
			local: {
				get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...storage }),
				set: async (values: Record<string, unknown>) => {
					await state.setInterceptor?.(values);
					Object.assign(storage, values);
				},
				remove: async (keys: string | string[]) => {
					if (state.throwNextRemove) {
						state.throwNextRemove = false;
						throw new Error("storage_remove_failed");
					}
					for (const key of Array.isArray(keys) ? keys : [keys]) {
						delete storage[key];
					}
				}
			},
			onChanged: { addListener }
		},
		tabs: {
			create: async (createInfo: Record<string, unknown>) => {
				const tab = { ...createInfo, id: createdTabs.length + 1, windowId: 1 };
				createdTabs.push(tab);
				return tab;
			},
			onRemoved: { addListener },
			onUpdated: { addListener },
			query: async () => [],
			sendMessage: async () => undefined
		},
		windows: { update: async () => undefined }
	};
}

function getApi() {
	return (globalThis as { OTPCompanionBackground: BackgroundApi }).OTPCompanionBackground;
}

function getCreatedTabs() {
	return (globalThis as {
		__OTP_CHROME_MOCK_STATE__: { createdTabs: Array<{ id: number }> };
	}).__OTP_CHROME_MOCK_STATE__.createdTabs;
}

function getMockState() {
	return (globalThis as {
		__OTP_CHROME_MOCK_STATE__: {
			createdTabs: Array<{ id: number }>;
			storage: Record<string, unknown>;
			setInterceptor: null | ((values: Record<string, unknown>) => Promise<void> | void);
			throwNextRemove: boolean;
		};
	}).__OTP_CHROME_MOCK_STATE__;
}

async function flushScheduler() {
	for (let index = 0; index < 8; index += 1) {
		await Promise.resolve();
	}
}

function importParams(requestId: string, platform: string) {
	return {
		package: {
			version: 1,
			source: "obsidian-to-publish",
			requestId,
			targets: [platform]
		}
	};
}

describe("Chrome companion platform task scheduler", () => {
	beforeEach(() => {
		(globalThis as Record<string, unknown>).__OTP_COMPANION_BACKGROUND_TEST__ = true;
		installChromeMock();
		delete require.cache[backgroundPath];
		require(backgroundPath);
	});

	afterEach(async () => {
		await getApi()?.clearTask();
		delete (globalThis as Record<string, unknown>).OTPCompanionBackground;
		delete (globalThis as Record<string, unknown>).__OTP_COMPANION_BACKGROUND_TEST__;
		delete (globalThis as Record<string, unknown>).__OTP_CHROME_MOCK_STATE__;
		delete (globalThis as Record<string, unknown>).chrome;
		delete require.cache[backgroundPath];
	});

	it("runs at most two different platforms at once and immediately accepts queued work", async () => {
		const api = getApi();
		const x = await api.importDraft(importParams("x-1", "x"));
		const zhihu = await api.importDraft(importParams("zhihu-1", "zhihu"));
		const juejin = await api.importDraft(importParams("juejin-1", "juejin"));
		await flushScheduler();

		expect(x.accepted).toBe(true);
		expect(zhihu.accepted).toBe(true);
		expect(juejin).toMatchObject({ accepted: true, status: "queued" });
		expect(api.getSchedulerSnapshot().activeTaskIdsByPlatform).toEqual({
			x: "x-1",
			zhihu: "zhihu-1"
		});
		expect(api.getSchedulerSnapshot().queuedTaskIdsByPlatform).toEqual({
			juejin: ["juejin-1"]
		});
		expect(getCreatedTabs()).toHaveLength(2);
	});

	it("rejects missing or duplicate active task ids", async () => {
		const api = getApi();
		await expect(api.importDraft(importParams("", "x")))
			.rejects.toThrow("Invalid publish package requestId");

		await api.importDraft(importParams("same-id", "x"));
		await expect(api.importDraft(importParams("same-id", "zhihu")))
			.rejects.toThrow("Duplicate active taskId");
	});

	it("serializes one platform while a failure releases only that platform's next task", async () => {
		const api = getApi();
		await api.importDraft(importParams("x-1", "x"));
		await api.importDraft(importParams("zhihu-1", "zhihu"));
		await api.importDraft(importParams("x-2", "x"));
		await flushScheduler();

		expect(api.getSchedulerSnapshot().queuedTaskIdsByPlatform).toEqual({ x: ["x-2"] });
		expect(getCreatedTabs()).toHaveLength(2);

		const result = await api.handleTaskResult(
			{ taskId: "x-1", platform: "x", status: "failed", reason: "editor_timeout" },
			{ tab: { id: 1 } }
		);
		await flushScheduler();

		expect(result).toEqual({ ok: true });
		expect(api.getSchedulerSnapshot().activeTaskIdsByPlatform).toEqual({
			zhihu: "zhihu-1",
			x: "x-2"
		});
		expect(getCreatedTabs()).toHaveLength(3);
	});

	it("rejects late or wrong-tab results without releasing a task slot", async () => {
		const api = getApi();
		await api.importDraft(importParams("x-1", "x"));
		await api.importDraft(importParams("zhihu-1", "zhihu"));
		await api.importDraft(importParams("juejin-1", "juejin"));
		await flushScheduler();

		const wrongTab = await api.handleTaskResult(
			{ taskId: "x-1", platform: "x", status: "succeeded" },
			{ tab: { id: 2 } }
		);
		const wrongTask = await api.handleTaskResult(
			{ taskId: "missing", platform: "x", status: "failed" },
			{ tab: { id: 1 } }
		);
		await flushScheduler();

		expect(wrongTab).toEqual({ ok: false, error: "task_identity_mismatch" });
		expect(wrongTask).toEqual({ ok: false, error: "task_identity_mismatch" });
		expect(api.getSchedulerSnapshot().activeTaskIdsByPlatform).toEqual({
			x: "x-1",
			zhihu: "zhihu-1"
		});
		expect(api.getSchedulerSnapshot().queuedTaskIdsByPlatform).toEqual({
			juejin: ["juejin-1"]
		});
		expect(getCreatedTabs()).toHaveLength(2);
	});

	it("releases a closed tab's slot and starts the next platform", async () => {
		const api = getApi();
		await api.importDraft(importParams("x-1", "x"));
		await api.importDraft(importParams("zhihu-1", "zhihu"));
		await api.importDraft(importParams("juejin-1", "juejin"));
		await flushScheduler();

		await api.handleTabRemoved(1);
		await flushScheduler();

		expect(api.getSchedulerSnapshot().activeTaskIdsByPlatform).toEqual({
			zhihu: "zhihu-1",
			juejin: "juejin-1"
		});
		expect(getCreatedTabs()).toHaveLength(3);
	});

	it("keeps scheduling when settled-task storage cleanup fails", async () => {
		const api = getApi();
		await api.importDraft(importParams("x-1", "x"));
		await api.importDraft(importParams("x-2", "x"));
		await flushScheduler();

		getMockState().throwNextRemove = true;
		const result = await api.handleTaskResult(
			{ taskId: "x-1", platform: "x", status: "failed" },
			{ tab: { id: 1 } }
		);
		await flushScheduler();

		expect(result).toEqual({ ok: true });
		expect(api.getSchedulerSnapshot().activeTaskIdsByPlatform).toEqual({ x: "x-2" });
		expect(getCreatedTabs()).toHaveLength(2);
	});

	it("removes a task that settles while its platform storage write is pending", async () => {
		const api = getApi();
		let releasePersist: (() => void) | null = null;
		const persistGate = new Promise<void>((resolve) => {
			releasePersist = resolve;
		});
		getMockState().setInterceptor = (values) => {
			if (values["task:x"]) {
				return persistGate;
			}
		};

		await api.importDraft(importParams("x-1", "x"));
		await flushScheduler();
		expect(api.getSchedulerSnapshot().tasks).toContainEqual({
			id: "x-1",
			platform: "x",
			status: "persisting",
			tabId: 1
		});

		await api.handleTabRemoved(1);
		releasePersist?.();
		await flushScheduler();

		expect(getMockState().storage["task:x"]).toBeUndefined();
		expect(getMockState().storage.latestTask).toBeNull();
		expect(api.getSchedulerSnapshot().tasks).toEqual([]);
	});
});
