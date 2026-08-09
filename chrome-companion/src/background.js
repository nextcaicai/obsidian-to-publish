const DEFAULT_BRIDGE_PORT = 27127;
const STORAGE_KEYS = {
	port: "bridgePort",
	token: "bridgeToken",
	latestTask: "latestTask",
	// Legacy aggregate map. Kept for migration/read fallback only.
	tasksByPlatform: "tasksByPlatform"
};
const TASK_KEY_PREFIX = "task:";
const TASK_DELIVER_RETRY_LIMIT = 40;
const TASK_DELIVER_RETRY_MS = 500;

const SUPPORTED_PLATFORMS = [
	{ id: "x", label: "X Articles", editorUrl: "https://x.com/compose/articles" },
	{ id: "csdn", label: "CSDN", editorUrl: "https://editor.csdn.net/md/" },
	{ id: "juejin", label: "掘金", editorUrl: "https://juejin.cn/editor/drafts/new?v=2" },
	{ id: "zhihu", label: "知乎", editorUrl: "https://zhuanlan.zhihu.com/write" },
	{ id: "substack", label: "Substack", editorUrl: "https://nextcaicai.substack.com/publish/post/" },
	{ id: "xiaohongshu", label: "小红书", editorUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article" },
	{ id: "bilibili", label: "B站专栏", editorUrl: "https://member.bilibili.com/platform/upload/text" },
	{ id: "zhishixingqiu", label: "知识星球", editorUrl: "https://wx.zsxq.com" }
];

/** @type {Map<number, object>} */
const tasksByTabId = new Map();
/** @type {Map<string, object>} */
const tasksByPlatformMemory = new Map();
/** @type {Map<number, number>} */
const deliverTimersByTabId = new Map();

let bridgeSocket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let importDraftQueue = Promise.resolve();
let connectionState = {
	connected: false,
	lastError: "",
	lastConnectedAt: 0
};

chrome.runtime.onInstalled.addListener(() => {
	void connectBridge();
});

chrome.runtime.onStartup.addListener(() => {
	void connectBridge();
});

chrome.action.onClicked.addListener(() => {
	chrome.runtime.openOptionsPage();
	void connectBridge();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local") {
		return;
	}

	if (changes[STORAGE_KEYS.port] || changes[STORAGE_KEYS.token]) {
		void reconnectBridge();
	}
});

chrome.tabs.onRemoved.addListener((tabId) => {
	tasksByTabId.delete(tabId);
	clearDeliverTimer(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status !== "complete" && !changeInfo.url) {
		return;
	}
	if (!tasksByTabId.has(tabId)) {
		return;
	}
	void deliverTaskToTab(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	void handleRuntimeMessage(message, sender).then(sendResponse);
	return true;
});

async function handleRuntimeMessage(message, sender) {
	if (!message || typeof message !== "object") {
		return { ok: false, error: "invalid_message" };
	}

	if (message.type === "bridge.connect") {
		await connectBridge();
		return { ok: true, state: connectionState };
	}

	if (message.type === "bridge.status") {
		return { ok: true, state: connectionState };
	}

	if (message.type === "task.getLatest") {
		const platform = typeof message.platform === "string" ? message.platform.trim() : "";
		const tabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;
		const task = await resolveTaskForRequest(platform, tabId);
		return { ok: true, task };
	}

	if (message.type === "task.clearLatest") {
		const platform = typeof message.platform === "string" ? message.platform.trim() : "";
		const tabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;
		await clearTask({ platform, tabId });
		return { ok: true };
	}

	return { ok: false, error: "unknown_message" };
}

async function reconnectBridge() {
	closeBridge();
	await connectBridge();
}

async function connectBridge() {
	const { bridgePort, bridgeToken } = await chrome.storage.local.get({
		[STORAGE_KEYS.port]: DEFAULT_BRIDGE_PORT,
		[STORAGE_KEYS.token]: ""
	});

	if (!bridgeToken) {
		connectionState = {
			connected: false,
			lastError: "missing_token",
			lastConnectedAt: 0
		};
		return;
	}

	if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
		return;
	}

	closeBridge();
	const url = `ws://127.0.0.1:${bridgePort}/bridge?token=${encodeURIComponent(bridgeToken)}`;
	try {
		bridgeSocket = new WebSocket(url);
	} catch (error) {
		connectionState = {
			connected: false,
			lastError: String(error),
			lastConnectedAt: 0
		};
		scheduleReconnect();
		return;
	}

	bridgeSocket.addEventListener("open", () => {
		connectionState = {
			connected: true,
			lastError: "",
			lastConnectedAt: Date.now()
		};
		sendBridgeMessage({
			type: "extension.hello",
			label: "Obsidian to Publish Companion",
			version: chrome.runtime.getManifest().version,
			capabilities: {
				platforms: SUPPORTED_PLATFORMS.map((platform) => platform.id)
			}
		});
		startHeartbeat();
	});

	bridgeSocket.addEventListener("message", (event) => {
		void handleBridgeMessage(event.data);
	});

	bridgeSocket.addEventListener("close", () => {
		stopHeartbeat();
		connectionState = {
			connected: false,
			lastError: "closed",
			lastConnectedAt: connectionState.lastConnectedAt
		};
		scheduleReconnect();
	});

	bridgeSocket.addEventListener("error", () => {
		connectionState = {
			connected: false,
			lastError: "websocket_error",
			lastConnectedAt: connectionState.lastConnectedAt
		};
	});
}

function closeBridge() {
	stopHeartbeat();
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}

	if (bridgeSocket) {
		try {
			bridgeSocket.close();
		} catch {
			// The next connect attempt owns recovery.
		}
		bridgeSocket = null;
	}
}

function startHeartbeat() {
	stopHeartbeat();
	heartbeatTimer = setInterval(() => {
		sendBridgeMessage({
			type: "extension.ping",
			at: Date.now()
		});
	}, 20000);
}

function stopHeartbeat() {
	if (!heartbeatTimer) {
		return;
	}

	clearInterval(heartbeatTimer);
	heartbeatTimer = null;
}

function scheduleReconnect() {
	if (reconnectTimer) {
		return;
	}

	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		void connectBridge();
	}, 3000);
}

async function handleBridgeMessage(rawMessage) {
	let message;
	try {
		message = JSON.parse(rawMessage);
	} catch {
		return;
	}

	if (!message || typeof message !== "object") {
		return;
	}

	if (message.type === "extension.hello_ack") {
		return;
	}

	if (typeof message.id !== "string" || typeof message.method !== "string") {
		return;
	}

	try {
		if (message.method === "platform.list") {
			sendBridgeResponse(message.id, {
				connected: true,
				platforms: SUPPORTED_PLATFORMS
			});
			return;
		}

		if (message.method === "article.importDraft") {
			const result = await enqueueImportDraft(message.params);
			sendBridgeResponse(message.id, result);
			return;
		}

		sendBridgeError(message.id, `Unsupported method: ${message.method}`);
	} catch (error) {
		sendBridgeError(message.id, error instanceof Error ? error.message : String(error));
	}
}

function enqueueImportDraft(params) {
	const run = importDraftQueue.then(() => importDraft(params));
	// Keep the queue alive even when one import fails.
	importDraftQueue = run.then(() => undefined, () => undefined);
	return run;
}

async function importDraft(params) {
	const publishPackage = params?.package;
	if (!publishPackage || publishPackage.source !== "obsidian-to-publish" || publishPackage.version !== 1) {
		throw new Error("Invalid publish package.");
	}

	const platform = resolveTargetPlatform(publishPackage);
	const task = {
		id: publishPackage.requestId,
		platform: platform.id,
		createdAt: new Date().toISOString(),
		package: publishPackage
	};

	tasksByPlatformMemory.set(platform.id, task);
	await persistPlatformTask(platform.id, task);

	const tab = await chrome.tabs.create({
		url: platform.editorUrl,
		// Keep previously opened multi-select tabs alive without stealing focus each time.
		active: true
	});
	if (typeof tab.id === "number") {
		tasksByTabId.set(tab.id, task);
		void deliverTaskToTab(tab.id);
	}
	if (typeof tab.windowId === "number") {
		await chrome.windows.update(tab.windowId, {
			focused: true
		});
	}

	return {
		accepted: true,
		taskId: task.id,
		platform: platform.id,
		editorUrl: platform.editorUrl,
		tabId: typeof tab.id === "number" ? tab.id : null
	};
}

async function persistPlatformTask(platformId, task) {
	const platformKey = getPlatformTaskKey(platformId);
	try {
		await chrome.storage.local.set({
			[platformKey]: task,
			[STORAGE_KEYS.latestTask]: task
		});
		return;
	} catch (error) {
		console.warn("Failed to persist full platform task package, retrying without large assets.", error);
	}

	// Fallback: store a package without base64 assets so multi-platform text injection still works.
	const lightweightTask = createLightweightTask(task);
	await chrome.storage.local.set({
		[platformKey]: lightweightTask,
		[STORAGE_KEYS.latestTask]: lightweightTask
	});
	// Keep the full package only in memory for this service-worker lifetime.
	tasksByPlatformMemory.set(platformId, task);
}

function createLightweightTask(task) {
	const publishPackage = task?.package;
	if (!publishPackage || typeof publishPackage !== "object") {
		return task;
	}

	return {
		...task,
		package: {
			...publishPackage,
			assets: [],
			article: {
				...(publishPackage.article || {}),
				// Keep markdown/html/text for body fill; drop heavy binary assets.
			},
			warnings: [
				...(Array.isArray(publishPackage.warnings) ? publishPackage.warnings : []),
				{
					code: "assets_stripped_for_storage",
					message: "图片资源过大，未写入本地缓存；当前标签页仍可使用内存中的完整任务。"
				}
			]
		}
	};
}

async function resolveTaskForRequest(platform, tabId) {
	if (typeof tabId === "number" && tasksByTabId.has(tabId)) {
		const tabTask = tasksByTabId.get(tabId);
		if (!platform || tabTask.platform === platform) {
			return tabTask;
		}
	}

	if (platform && tasksByPlatformMemory.has(platform)) {
		return tasksByPlatformMemory.get(platform);
	}

	if (platform) {
		const storedPlatformTask = await readPlatformTask(platform);
		if (storedPlatformTask) {
			tasksByPlatformMemory.set(platform, storedPlatformTask);
			return storedPlatformTask;
		}
	}

	const { latestTask } = await chrome.storage.local.get({
		[STORAGE_KEYS.latestTask]: null
	});
	if (latestTask && (!platform || latestTask.platform === platform)) {
		return latestTask;
	}

	return null;
}

async function readPlatformTask(platform) {
	const platformKey = getPlatformTaskKey(platform);
	const stored = await chrome.storage.local.get({
		[platformKey]: null,
		[STORAGE_KEYS.tasksByPlatform]: {}
	});

	if (stored[platformKey]) {
		return stored[platformKey];
	}

	// Legacy fallback for older companion builds.
	const tasksByPlatform = isPlainObject(stored[STORAGE_KEYS.tasksByPlatform])
		? stored[STORAGE_KEYS.tasksByPlatform]
		: {};
	return tasksByPlatform[platform] || null;
}

async function clearTask({ platform = "", tabId = null } = {}) {
	if (typeof tabId === "number") {
		const tabTask = tasksByTabId.get(tabId);
		tasksByTabId.delete(tabId);
		clearDeliverTimer(tabId);
		if (!platform && tabTask?.platform) {
			platform = tabTask.platform;
		}
	}

	if (!platform) {
		tasksByTabId.clear();
		tasksByPlatformMemory.clear();
		for (const timerTabId of deliverTimersByTabId.keys()) {
			clearDeliverTimer(timerTabId);
		}
		const keysToRemove = [STORAGE_KEYS.latestTask, STORAGE_KEYS.tasksByPlatform];
		for (const item of SUPPORTED_PLATFORMS) {
			keysToRemove.push(getPlatformTaskKey(item.id));
		}
		await chrome.storage.local.remove(keysToRemove);
		return;
	}

	tasksByPlatformMemory.delete(platform);
	for (const [mappedTabId, task] of tasksByTabId.entries()) {
		if (task.platform === platform) {
			tasksByTabId.delete(mappedTabId);
			clearDeliverTimer(mappedTabId);
		}
	}

	const platformKey = getPlatformTaskKey(platform);
	const stored = await chrome.storage.local.get({
		[STORAGE_KEYS.latestTask]: null,
		[STORAGE_KEYS.tasksByPlatform]: {}
	});
	const patchRemove = [platformKey];
	const tasksByPlatform = isPlainObject(stored[STORAGE_KEYS.tasksByPlatform])
		? { ...stored[STORAGE_KEYS.tasksByPlatform] }
		: {};
	if (platform in tasksByPlatform) {
		delete tasksByPlatform[platform];
	}

	const updates = {
		[STORAGE_KEYS.tasksByPlatform]: tasksByPlatform
	};
	if (stored[STORAGE_KEYS.latestTask]?.platform === platform) {
		updates[STORAGE_KEYS.latestTask] = null;
	}
	await chrome.storage.local.set(updates);
	await chrome.storage.local.remove(patchRemove);
}

async function deliverTaskToTab(tabId) {
	const task = tasksByTabId.get(tabId);
	if (!task) {
		return false;
	}

	clearDeliverTimer(tabId);

	for (let attempt = 0; attempt < TASK_DELIVER_RETRY_LIMIT; attempt += 1) {
		if (!tasksByTabId.has(tabId)) {
			return false;
		}

		try {
			await chrome.tabs.sendMessage(tabId, {
				type: "task.deliver",
				task
			});
			return true;
		} catch {
			// Content script may not be ready yet, especially on SPA editor boot.
			await delay(TASK_DELIVER_RETRY_MS);
		}
	}

	return false;
}

function clearDeliverTimer(tabId) {
	const timer = deliverTimersByTabId.get(tabId);
	if (timer) {
		clearTimeout(timer);
		deliverTimersByTabId.delete(tabId);
	}
}

function getPlatformTaskKey(platformId) {
	return `${TASK_KEY_PREFIX}${platformId}`;
}

function resolveTargetPlatform(publishPackage) {
	const target = Array.isArray(publishPackage.targets) ? publishPackage.targets[0] : "";
	const platform = SUPPORTED_PLATFORMS.find((item) => item.id === target);
	if (!platform) {
		throw new Error(`Unsupported target platform: ${target}`);
	}

	return platform;
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function delay(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function sendBridgeResponse(id, result) {
	sendBridgeMessage({ id, result });
}

function sendBridgeError(id, error) {
	sendBridgeMessage({ id, error });
}

function sendBridgeMessage(payload) {
	if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
		return;
	}

	bridgeSocket.send(JSON.stringify(payload));
}
