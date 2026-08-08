const DEFAULT_BRIDGE_PORT = 27127;
const STORAGE_KEYS = {
	port: "bridgePort",
	token: "bridgeToken",
	latestTask: "latestTask",
	tasksByPlatform: "tasksByPlatform"
};

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

let bridgeSocket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	void handleRuntimeMessage(message, sender).then(sendResponse);
	return true;
});

async function handleRuntimeMessage(message) {
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
		const stored = await chrome.storage.local.get({
			[STORAGE_KEYS.latestTask]: null,
			[STORAGE_KEYS.tasksByPlatform]: {}
		});
		const tasksByPlatform = isPlainObject(stored[STORAGE_KEYS.tasksByPlatform])
			? stored[STORAGE_KEYS.tasksByPlatform]
			: {};
		if (platform && tasksByPlatform[platform]) {
			return { ok: true, task: tasksByPlatform[platform] };
		}

		const latestTask = stored[STORAGE_KEYS.latestTask] || null;
		if (platform && latestTask && latestTask.platform !== platform) {
			return { ok: true, task: null };
		}

		return { ok: true, task: latestTask };
	}

	if (message.type === "task.clearLatest") {
		const platform = typeof message.platform === "string" ? message.platform.trim() : "";
		if (!platform) {
			await chrome.storage.local.remove([STORAGE_KEYS.latestTask, STORAGE_KEYS.tasksByPlatform]);
			return { ok: true };
		}

		const stored = await chrome.storage.local.get({
			[STORAGE_KEYS.latestTask]: null,
			[STORAGE_KEYS.tasksByPlatform]: {}
		});
		const tasksByPlatform = isPlainObject(stored[STORAGE_KEYS.tasksByPlatform])
			? { ...stored[STORAGE_KEYS.tasksByPlatform] }
			: {};
		delete tasksByPlatform[platform];

		const patch = {
			[STORAGE_KEYS.tasksByPlatform]: tasksByPlatform
		};
		if (stored[STORAGE_KEYS.latestTask]?.platform === platform) {
			patch[STORAGE_KEYS.latestTask] = null;
		}
		await chrome.storage.local.set(patch);
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
			const result = await importDraft(message.params);
			sendBridgeResponse(message.id, result);
			return;
		}

		sendBridgeError(message.id, `Unsupported method: ${message.method}`);
	} catch (error) {
		sendBridgeError(message.id, error instanceof Error ? error.message : String(error));
	}
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
	const stored = await chrome.storage.local.get({
		[STORAGE_KEYS.tasksByPlatform]: {}
	});
	const tasksByPlatform = isPlainObject(stored[STORAGE_KEYS.tasksByPlatform])
		? { ...stored[STORAGE_KEYS.tasksByPlatform] }
		: {};
	tasksByPlatform[platform.id] = task;
	await chrome.storage.local.set({
		[STORAGE_KEYS.latestTask]: task,
		[STORAGE_KEYS.tasksByPlatform]: tasksByPlatform
	});
	const tab = await chrome.tabs.create({ url: platform.editorUrl, active: true });
	if (typeof tab.windowId === "number") {
		await chrome.windows.update(tab.windowId, {
			focused: true
		});
	}

	return {
		accepted: true,
		taskId: task.id,
		platform: platform.id,
		editorUrl: platform.editorUrl
	};
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
