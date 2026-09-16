const DEFAULT_BRIDGE_PORT = 27127;
const STORAGE_KEYS = {
	port: "bridgePort",
	token: "bridgeToken",
	latestTask: "latestTask",
	substackEditorUrl: "substackEditorUrl",
	// Legacy aggregate map. Kept for migration/read fallback only.
	tasksByPlatform: "tasksByPlatform"
};
const TASK_KEY_PREFIX = "task:";
const TASK_DELIVER_RETRY_LIMIT = 40;
const TASK_DELIVER_RETRY_MS = 500;
const TASK_CACHE_TTL_MS = 30 * 60 * 1000;
const TASK_LIFECYCLE_TIMEOUT_MS = 5 * 60 * 1000;
const TASK_RECEIPT_TIMEOUT_MS = 22000;
const MAX_CONCURRENT_PLATFORM_TASKS = 2;
const SUBSTACK_DASHBOARD_PATH = "/publish/home";

const SUPPORTED_PLATFORMS = [
	{ id: "x", label: "X Articles", editorUrl: "https://x.com/compose/articles" },
	{ id: "csdn", label: "CSDN", editorUrl: "https://editor.csdn.net/md/" },
	{ id: "juejin", label: "掘金", editorUrl: "https://juejin.cn/editor/drafts/new?v=2" },
	{ id: "zhihu", label: "知乎", editorUrl: "https://zhuanlan.zhihu.com/write" },
	{ id: "substack", label: "Substack", editorUrl: "" },
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
/** @type {Map<string, object>} */
const tasksById = new Map();
/** @type {Map<string, string[]>} */
const queuedTaskIdsByPlatform = new Map();
/** @type {string[]} */
const readyPlatformQueue = [];
/** @type {Map<string, string>} */
const activeTaskIdByPlatform = new Map();
/** @type {Map<string, number>} */
const lifecycleTimersByTaskId = new Map();
/** @type {Map<string, Array<(receipt: object) => void>>} */
const taskReceiptWaitersByTaskId = new Map();

let bridgeSocket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let connectionState = {
	connected: false,
	connecting: false,
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
	void handleTabRemoved(tabId);
});

async function handleTabRemoved(tabId) {
	const task = tasksByTabId.get(tabId);
	if (task) {
		await settleTask(task.id, { status: "failed", reason: "tab_closed" });
		return;
	}
	clearDeliverTimer(tabId);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status !== "complete" && !changeInfo.url) {
		return;
	}
	const task = tasksByTabId.get(tabId);
	if (!task) {
		return;
	}
	if (task.platform === "substack" && changeInfo.url && !isAllowedSubstackTaskUrl(changeInfo.url)) {
		void invalidateSubstackPublisherUrl(task.editorUrl);
		void settleTask(task.id, { status: "failed", reason: getSubstackTaskUrlFailure(changeInfo.url) });
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
		const taskId = typeof message.taskId === "string" ? message.taskId.trim() : "";
		if (taskId) {
			return handleTaskResult({
				taskId,
				platform,
				status: "cancelled",
				reason: "dismissed"
			}, sender);
		}
		await clearTask({ platform, tabId });
		return { ok: true };
	}

	if (message.type === "task.result") {
		return handleTaskResult(message, sender);
	}

	if (message.type === "task.stage") {
		return handleTaskStage(message, sender);
	}

	if (message.type === "task.clearAll") {
		await clearTask();
		return { ok: true };
	}

	if (message.type === "substack.rememberEditorUrl") {
		const remembered = await rememberSubstackEditorUrl(message.url);
		return { ok: remembered };
	}

	if (message.type === "substack.saveEditorUrl") {
		return saveSubstackEditorUrl(message.url);
	}

	if (message.type === "substack.detectEditorUrl") {
		try {
			const editorUrl = await findOpenSubstackEditorUrl();
			if (editorUrl) {
				await rememberSubstackEditorUrl(editorUrl);
				return { ok: true, editorUrl };
			}
			return { ok: false, error: "not_found" };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
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
		closeBridge();
		connectionState = {
			connected: false,
			connecting: false,
			lastError: "missing_token",
			lastConnectedAt: 0
		};
		return;
	}

	if (bridgeSocket && (
		bridgeSocket.readyState === WebSocket.OPEN
		|| bridgeSocket.readyState === WebSocket.CONNECTING
	)) {
		return;
	}

	closeBridge();
	const url = `ws://127.0.0.1:${bridgePort}/bridge?token=${encodeURIComponent(bridgeToken)}`;
	connectionState = {
		connected: false,
		connecting: true,
		lastError: "",
		lastConnectedAt: connectionState.lastConnectedAt
	};
	try {
		bridgeSocket = new WebSocket(url);
	} catch (error) {
		connectionState = {
			connected: false,
			connecting: false,
			lastError: String(error),
			lastConnectedAt: 0
		};
		scheduleReconnect();
		return;
	}

	const socket = bridgeSocket;
	socket.addEventListener("open", () => {
		if (!isCurrentBridgeSocket(socket)) {
			return;
		}
		connectionState = {
			connected: true,
			connecting: false,
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

	socket.addEventListener("message", (event) => {
		if (!isCurrentBridgeSocket(socket)) {
			return;
		}
		void handleBridgeMessage(event.data);
	});

	socket.addEventListener("close", () => {
		if (!isCurrentBridgeSocket(socket)) {
			return;
		}
		stopHeartbeat();
		bridgeSocket = null;
		connectionState = {
			connected: false,
			connecting: false,
			lastError: connectionState.lastError || "closed",
			lastConnectedAt: connectionState.lastConnectedAt
		};
		scheduleReconnect();
	});

	socket.addEventListener("error", () => {
		if (!isCurrentBridgeSocket(socket)) {
			return;
		}
		connectionState = {
			connected: false,
			connecting: false,
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
		const socket = bridgeSocket;
		bridgeSocket = null;
		try {
			socket.close();
		} catch {
			// The next connect attempt owns recovery.
		}
	}
}

function isCurrentBridgeSocket(socket) {
	return bridgeSocket === socket;
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
	return importDraft(params);
}

async function importDraft(params) {
	const publishPackage = params?.package;
	if (!publishPackage || publishPackage.source !== "obsidian-to-publish" || publishPackage.version !== 1) {
		throw new Error("Invalid publish package.");
	}
	const taskId = typeof publishPackage.requestId === "string" ? publishPackage.requestId.trim() : "";
	if (!taskId) {
		throw new Error("Invalid publish package requestId.");
	}
	await clearExpiredTasks();
	if (tasksById.has(taskId)) {
		throw new Error(`Duplicate active taskId: ${taskId}`);
	}

	const platform = await resolveTargetPlatform(publishPackage);
	const createdAtMs = Date.now();
	const task = {
		id: taskId,
		platform: platform.id,
		editorUrl: platform.editorUrl,
		createdAt: new Date(createdAtMs).toISOString(),
		expiresAt: new Date(createdAtMs + TASK_CACHE_TTL_MS).toISOString(),
		package: publishPackage,
		status: "queued",
		tabId: null
	};

	tasksById.set(task.id, task);
	queueTask(task);
	void drainTaskQueue();

	const queuedReceipt = {
		accepted: true,
		taskId: task.id,
		platform: platform.id,
		editorUrl: platform.editorUrl,
		tabId: null,
		status: task.status
	};

	if (params?.awaitReceipt !== true) {
		return queuedReceipt;
	}

	return await waitForTaskReceipt(task, params?.receiptTimeoutMs);
}

function queueTask(task) {
	const queue = queuedTaskIdsByPlatform.get(task.platform) || [];
	const wasEmpty = queue.length === 0;
	queue.push(task.id);
	queuedTaskIdsByPlatform.set(task.platform, queue);

	if (wasEmpty && !activeTaskIdByPlatform.has(task.platform)) {
		readyPlatformQueue.push(task.platform);
	}
}

async function drainTaskQueue() {
	while (activeTaskIdByPlatform.size < MAX_CONCURRENT_PLATFORM_TASKS) {
		const nextTask = dequeueNextRunnableTask();
		if (!nextTask) {
			return;
		}
		startTask(nextTask);
	}
}

function dequeueNextRunnableTask() {
	while (readyPlatformQueue.length > 0) {
		const platform = readyPlatformQueue.shift();
		if (!platform || activeTaskIdByPlatform.has(platform)) {
			continue;
		}

		const queue = queuedTaskIdsByPlatform.get(platform) || [];
		const taskId = queue.shift();
		if (queue.length > 0) {
			queuedTaskIdsByPlatform.set(platform, queue);
		} else {
			queuedTaskIdsByPlatform.delete(platform);
		}

		const task = taskId ? tasksById.get(taskId) : null;
		if (task?.status === "queued") {
			return task;
		}
	}

	return null;
}

function startTask(task) {
	if (!task || task.status !== "queued" || activeTaskIdByPlatform.has(task.platform)) {
		return;
	}

	task.status = "starting";
	activeTaskIdByPlatform.set(task.platform, task.id);
	void openTaskEditor(task);
}

async function openTaskEditor(task) {
	try {
		const tab = await chrome.tabs.create({
			url: task.editorUrl || (SUPPORTED_PLATFORMS.find((item) => item.id === task.platform)?.editorUrl || ""),
			// Keep the existing draft-opening behavior. Focus arbitration is deliberately
			// separate from the task scheduler so it cannot serialize lifecycle completion.
			active: true
		});
		if (typeof tab.id !== "number") {
			throw new Error("editor_tab_not_created");
		}
		await focusEditorWindow(tab);

		if (!isCurrentActiveTask(task)) {
			return;
		}

		task.tabId = tab.id;
		task.status = "persisting";
		tasksByTabId.set(tab.id, task);
		tasksByPlatformMemory.set(task.platform, task);
		await persistPlatformTask(task.platform, task);
		if (!isCurrentActiveTask(task)) {
			try {
				await clearPersistedTask(task);
			} catch (error) {
				console.warn("Failed to clear a stale persisted task after it settled.", error);
			}
			return;
		}
		task.status = "running";
		startLifecycleTimer(task);
		void deliverTaskToTab(tab.id, task.id).then((delivered) => {
			if (!delivered) {
				void settleTask(task.id, { status: "failed", reason: "delivery_timeout" });
			}
		});
	} catch (error) {
		void settleTask(task.id, {
			status: "failed",
			reason: error instanceof Error ? error.message : String(error)
		});
	}
}

async function focusEditorWindow(tab) {
	if (typeof tab?.windowId !== "number") {
		return;
	}
	try {
		await chrome.windows.update(tab.windowId, { focused: true });
	} catch (error) {
		console.warn("Failed to focus the browser window for the editor tab.", error);
	}
}

function startLifecycleTimer(task) {
	clearLifecycleTimer(task.id);
	const timer = setTimeout(() => {
		void settleTask(task.id, { status: "failed", reason: "lifecycle_timeout" });
	}, TASK_LIFECYCLE_TIMEOUT_MS);
	lifecycleTimersByTaskId.set(task.id, timer);
}

function clearLifecycleTimer(taskId) {
	const timer = lifecycleTimersByTaskId.get(taskId);
	if (timer) {
		clearTimeout(timer);
		lifecycleTimersByTaskId.delete(taskId);
	}
}

async function handleTaskResult(message, sender) {
	const taskId = typeof message?.taskId === "string" ? message.taskId.trim() : "";
	const platform = typeof message?.platform === "string" ? message.platform.trim() : "";
	const tabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;
	if (!taskId || !platform || tabId === null) {
		return { ok: false, error: "invalid_task_result" };
	}

	const task = tasksById.get(taskId);
	if (!task || !isMatchingTaskIdentity(task, { taskId, platform, tabId })) {
		return { ok: false, error: "task_identity_mismatch" };
	}

	await settleTask(taskId, {
		status: normalizeTaskResultStatus(message.status),
		reason: typeof message.reason === "string" ? message.reason : ""
	});
	return { ok: true };
}

async function handleTaskStage(message, sender) {
	const taskId = typeof message?.taskId === "string" ? message.taskId.trim() : "";
	const platform = typeof message?.platform === "string" ? message.platform.trim() : "";
	const tabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;
	if (!taskId || !platform || tabId === null || message?.status !== "editor_ready") {
		return { ok: false, error: "invalid_task_stage" };
	}

	const task = tasksById.get(taskId);
	if (!task || !isMatchingTaskIdentity(task, { taskId, platform, tabId })) {
		return { ok: false, error: "task_identity_mismatch" };
	}

	task.status = "editor_ready";
	task.receipt = {
		status: "editor_ready",
		reason: typeof message.reason === "string" ? message.reason : ""
	};
	return { ok: true };
}

function normalizeTaskResultStatus(status) {
	return status === "succeeded" || status === "completed" ? "succeeded" : "failed";
}

function isMatchingTaskIdentity(task, { taskId, platform, tabId }) {
	return task?.id === taskId
		&& task.platform === platform
		&& task.tabId === tabId
		&& tasksByTabId.get(tabId)?.id === taskId
		&& activeTaskIdByPlatform.get(platform) === taskId;
}

function isCurrentActiveTask(task) {
	return task?.id
		&& activeTaskIdByPlatform.get(task.platform) === task.id
		&& tasksById.get(task.id) === task;
}

async function settleTask(taskId, { status = "failed", reason = "" } = {}) {
	const task = tasksById.get(taskId);
	if (!task || task.status === "settled") {
		return false;
	}

	task.status = "settled";
	task.completedAt = new Date().toISOString();
	task.result = { status, reason };
	resolveTaskReceiptWaiters(task, createTaskReceipt(task));
	clearLifecycleTimer(task.id);

	if (typeof task.tabId === "number" && tasksByTabId.get(task.tabId)?.id === task.id) {
		tasksByTabId.delete(task.tabId);
		clearDeliverTimer(task.tabId);
	}
	if (tasksByPlatformMemory.get(task.platform)?.id === task.id) {
		tasksByPlatformMemory.delete(task.platform);
	}
	if (activeTaskIdByPlatform.get(task.platform) === task.id) {
		activeTaskIdByPlatform.delete(task.platform);
	}
	removeQueuedTaskId(task.platform, task.id);
	tasksById.delete(task.id);

	try {
		await clearPersistedTask(task);
	} catch (error) {
		console.warn("Failed to clear a settled task from local storage.", error);
	} finally {
		if (queuedTaskIdsByPlatform.has(task.platform) && !activeTaskIdByPlatform.has(task.platform)) {
			readyPlatformQueue.push(task.platform);
		}
		void drainTaskQueue();
	}
	return true;
}

function waitForTaskReceipt(task, requestedTimeoutMs) {
	const timeoutMs = typeof requestedTimeoutMs === "number"
		&& Number.isFinite(requestedTimeoutMs)
		&& requestedTimeoutMs > 0
		? Math.min(requestedTimeoutMs, TASK_RECEIPT_TIMEOUT_MS)
		: TASK_RECEIPT_TIMEOUT_MS;
	const existingReceipt = createTaskReceipt(task);
	if (existingReceipt.status === "completed" || existingReceipt.status === "failed") {
		return Promise.resolve(existingReceipt);
	}

	return new Promise((resolve) => {
		const complete = (receipt) => {
			clearTimeout(timeout);
			removeTaskReceiptWaiter(task.id, complete);
			resolve(receipt);
		};
		const timeout = setTimeout(() => {
			const receipt = createTaskReceipt(task);
			complete(receipt.status === "editor_ready"
				? receipt
				: {
					accepted: false,
					taskId: task.id,
					platform: task.platform,
					status: "pending",
					reason: "editor_ready_timeout"
				});
		}, timeoutMs);
		const waiters = taskReceiptWaitersByTaskId.get(task.id) || [];
		waiters.push(complete);
		taskReceiptWaitersByTaskId.set(task.id, waiters);
	});
}

function createTaskReceipt(task) {
	if (task?.result?.status === "succeeded") {
		return {
			accepted: true,
			taskId: task.id,
			platform: task.platform,
			status: "completed",
			reason: task.result.reason || ""
		};
	}
	if (task?.result?.status === "failed") {
		return {
			accepted: false,
			taskId: task.id,
			platform: task.platform,
			status: "failed",
			reason: task.result.reason || ""
		};
	}
	if (task?.status === "editor_ready") {
		return {
			accepted: true,
			taskId: task.id,
			platform: task.platform,
			status: "editor_ready",
			reason: task.receipt?.reason || ""
		};
	}
	return {
		accepted: false,
		taskId: task?.id || "",
		platform: task?.platform || "",
		status: "pending",
		reason: ""
	};
}

function resolveTaskReceiptWaiters(task, receipt) {
	const waiters = taskReceiptWaitersByTaskId.get(task.id) || [];
	taskReceiptWaitersByTaskId.delete(task.id);
	for (const waiter of waiters) {
		waiter(receipt);
	}
}

function removeTaskReceiptWaiter(taskId, waiter) {
	const waiters = taskReceiptWaitersByTaskId.get(taskId) || [];
	const remaining = waiters.filter((candidate) => candidate !== waiter);
	if (remaining.length > 0) {
		taskReceiptWaitersByTaskId.set(taskId, remaining);
	} else {
		taskReceiptWaitersByTaskId.delete(taskId);
	}
}

function removeQueuedTaskId(platform, taskId) {
	const queue = queuedTaskIdsByPlatform.get(platform);
	if (!queue) {
		return;
	}
	const nextQueue = queue.filter((queuedTaskId) => queuedTaskId !== taskId);
	if (nextQueue.length > 0) {
		queuedTaskIdsByPlatform.set(platform, nextQueue);
	} else {
		queuedTaskIdsByPlatform.delete(platform);
	}
}

async function clearPersistedTask(task) {
	const platformKey = getPlatformTaskKey(task.platform);
	const stored = await chrome.storage.local.get({
		[platformKey]: null,
		[STORAGE_KEYS.latestTask]: null,
		[STORAGE_KEYS.tasksByPlatform]: {}
	});
	const updates = {};
	const keysToRemove = [];
	if (stored[platformKey]?.id === task.id) {
		keysToRemove.push(platformKey);
	}
	if (stored[STORAGE_KEYS.latestTask]?.id === task.id) {
		updates[STORAGE_KEYS.latestTask] = null;
	}
	const legacyTasks = isPlainObject(stored[STORAGE_KEYS.tasksByPlatform])
		? { ...stored[STORAGE_KEYS.tasksByPlatform] }
		: {};
	if (legacyTasks[task.platform]?.id === task.id) {
		delete legacyTasks[task.platform];
		updates[STORAGE_KEYS.tasksByPlatform] = legacyTasks;
	}

	if (Object.keys(updates).length > 0) {
		await chrome.storage.local.set(updates);
	}
	if (keysToRemove.length > 0) {
		await chrome.storage.local.remove(keysToRemove);
	}
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
		if (isTaskExpired(tabTask)) {
			await clearTask({ platform: tabTask?.platform || platform, tabId });
		} else if (!platform || tabTask.platform === platform) {
			return tabTask;
		}
	}

	if (platform && tasksByPlatformMemory.has(platform)) {
		const memoryTask = tasksByPlatformMemory.get(platform);
		if (isTaskExpired(memoryTask)) {
			await clearTask({ platform });
		} else {
			return memoryTask;
		}
	}

	if (platform) {
		const storedPlatformTask = await readPlatformTask(platform);
		if (storedPlatformTask) {
			if (isTaskExpired(storedPlatformTask)) {
				await clearTask({ platform });
			} else {
				tasksByPlatformMemory.set(platform, storedPlatformTask);
				return storedPlatformTask;
			}
		}
	}

	const { latestTask } = await chrome.storage.local.get({
		[STORAGE_KEYS.latestTask]: null
	});
	if (latestTask && (!platform || latestTask.platform === platform)) {
		if (isTaskExpired(latestTask)) {
			await clearTask({ platform: latestTask.platform || platform });
		} else {
			return latestTask;
		}
	}

	return null;
}

async function clearExpiredTasks() {
	const expiredTaskIds = [];
	for (const task of tasksById.values()) {
		if (isTaskExpired(task)) {
			expiredTaskIds.push(task.id);
		}
	}
	for (const taskId of expiredTaskIds) {
		await settleTask(taskId, { status: "failed", reason: "cache_expired" });
	}

	const expiredPlatforms = new Set();
	for (const [tabId, task] of tasksByTabId.entries()) {
		if (!isTaskExpired(task)) {
			continue;
		}
		tasksByTabId.delete(tabId);
		clearDeliverTimer(tabId);
		if (task.platform) {
			expiredPlatforms.add(task.platform);
		}
	}

	for (const [platform, task] of tasksByPlatformMemory.entries()) {
		if (!isTaskExpired(task)) {
			continue;
		}
		tasksByPlatformMemory.delete(platform);
		expiredPlatforms.add(platform);
	}

	const storageDefaults = {
		[STORAGE_KEYS.latestTask]: null,
		[STORAGE_KEYS.tasksByPlatform]: {}
	};
	for (const item of SUPPORTED_PLATFORMS) {
		storageDefaults[getPlatformTaskKey(item.id)] = null;
	}

	const stored = await chrome.storage.local.get(storageDefaults);
	const keysToRemove = [];
	const updates = {};
	const tasksByPlatform = isPlainObject(stored[STORAGE_KEYS.tasksByPlatform])
		? { ...stored[STORAGE_KEYS.tasksByPlatform] }
		: {};

	for (const item of SUPPORTED_PLATFORMS) {
		const platformTask = stored[getPlatformTaskKey(item.id)];
		if (platformTask && isTaskExpired(platformTask)) {
			keysToRemove.push(getPlatformTaskKey(item.id));
			expiredPlatforms.add(item.id);
		}
		if (tasksByPlatform[item.id] && isTaskExpired(tasksByPlatform[item.id])) {
			delete tasksByPlatform[item.id];
			expiredPlatforms.add(item.id);
		}
	}

	if (stored[STORAGE_KEYS.latestTask] && isTaskExpired(stored[STORAGE_KEYS.latestTask])) {
		updates[STORAGE_KEYS.latestTask] = null;
	}

	for (const platform of expiredPlatforms) {
		delete tasksByPlatform[platform];
	}
	if (expiredPlatforms.size > 0) {
		updates[STORAGE_KEYS.tasksByPlatform] = tasksByPlatform;
	}

	if (Object.keys(updates).length > 0) {
		await chrome.storage.local.set(updates);
	}
	if (keysToRemove.length > 0) {
		await chrome.storage.local.remove(keysToRemove);
	}
}

function isTaskExpired(task) {
	if (!task || typeof task !== "object") {
		return false;
	}

	const expiresAt = Date.parse(task.expiresAt || "");
	if (Number.isFinite(expiresAt)) {
		return expiresAt <= Date.now();
	}

	const createdAt = Date.parse(task.createdAt || "");
	return Number.isFinite(createdAt) && createdAt + TASK_CACHE_TTL_MS <= Date.now();
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
		if (tabTask?.id && isCurrentActiveTask(tabTask)) {
			await settleTask(tabTask.id, { status: "failed", reason: "cleared" });
			return;
		}
		tasksByTabId.delete(tabId);
		clearDeliverTimer(tabId);
		if (!platform && tabTask?.platform) {
			platform = tabTask.platform;
		}
	}

	if (!platform) {
		tasksByTabId.clear();
		tasksByPlatformMemory.clear();
		tasksById.clear();
		queuedTaskIdsByPlatform.clear();
		readyPlatformQueue.length = 0;
		activeTaskIdByPlatform.clear();
		for (const [taskId, waiters] of taskReceiptWaitersByTaskId.entries()) {
			taskReceiptWaitersByTaskId.delete(taskId);
			for (const waiter of waiters) {
				waiter({ accepted: false, taskId, platform: "", status: "failed", reason: "cleared" });
			}
		}
		for (const timerTabId of deliverTimersByTabId.keys()) {
			clearDeliverTimer(timerTabId);
		}
		for (const taskId of lifecycleTimersByTaskId.keys()) {
			clearLifecycleTimer(taskId);
		}
		const keysToRemove = [STORAGE_KEYS.latestTask, STORAGE_KEYS.tasksByPlatform];
		for (const item of SUPPORTED_PLATFORMS) {
			keysToRemove.push(getPlatformTaskKey(item.id));
		}
		await chrome.storage.local.remove(keysToRemove);
		return;
	}

	const activeTaskId = activeTaskIdByPlatform.get(platform);
	if (activeTaskId) {
		await settleTask(activeTaskId, { status: "failed", reason: "cleared" });
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

async function deliverTaskToTab(tabId, expectedTaskId = "") {
	const task = tasksByTabId.get(tabId);
	if (!task || task.status !== "running" || (expectedTaskId && task.id !== expectedTaskId) || !isCurrentActiveTask(task)) {
		return false;
	}

	clearDeliverTimer(tabId);

	for (let attempt = 0; attempt < TASK_DELIVER_RETRY_LIMIT; attempt += 1) {
		if (tasksByTabId.get(tabId)?.id !== task.id || task.status !== "running" || !isCurrentActiveTask(task)) {
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

async function resolveTargetPlatform(publishPackage) {
	const target = Array.isArray(publishPackage.targets) ? publishPackage.targets[0] : "";
	const platform = SUPPORTED_PLATFORMS.find((item) => item.id === target);
	if (!platform) {
		throw new Error(`Unsupported target platform: ${target}`);
	}

	if (platform.id === "substack") {
		return {
			...platform,
			editorUrl: await resolveSubstackEditorUrl()
		};
	}

	return platform;
}

async function resolveSubstackEditorUrl() {
	const stored = await chrome.storage.local.get({
		[STORAGE_KEYS.substackEditorUrl]: ""
	});
	const storedUrl = normalizeSubstackEditorUrl(stored[STORAGE_KEYS.substackEditorUrl]);
	if (storedUrl && isPersonalSubstackEditorUrl(storedUrl)) {
		return storedUrl;
	}

	const detectedUrl = await findOpenSubstackEditorUrl();
	if (detectedUrl) {
		await rememberSubstackEditorUrl(detectedUrl);
		return detectedUrl;
	}

	throw new Error(
		"substack_publisher_not_found: Open your personal Substack publisher page or save its URL in the Chrome extension options."
	);
}

async function findOpenSubstackEditorUrl() {
	if (!chrome.tabs?.query) {
		return "";
	}
	let tabs;
	try {
		tabs = await chrome.tabs.query({
			url: ["https://*.substack.com/publish/*"]
		});
	} catch {
		return "";
	}
	const personalTabs = tabs
		.filter((tab) => isPersonalSubstackPublisherUrl(tab.url))
		.sort(compareSubstackPublisherTabs);
	if (personalTabs.length === 0) {
		return "";
	}
	const preferred = personalTabs[0];
	const competingHosts = new Set(personalTabs.map((tab) => new URL(tab.url).hostname));
	if (!preferred.active && competingHosts.size > 1) {
		throw new Error("substack_publication_ambiguous: Open the target publication dashboard, then click Detect Substack again.");
	}
	return normalizeSubstackEditorUrl(preferred.url) || "";
}

async function rememberSubstackEditorUrl(value) {
	const normalized = normalizeSubstackEditorUrl(value);
	if (!isPersonalSubstackEditorUrl(normalized)) {
		return false;
	}
	await chrome.storage.local.set({
		[STORAGE_KEYS.substackEditorUrl]: normalized
	});
	return true;
}

async function saveSubstackEditorUrl(value) {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) {
		await chrome.storage.local.remove(STORAGE_KEYS.substackEditorUrl);
		return { ok: true, editorUrl: "" };
	}

	const normalized = normalizeSubstackEditorUrl(raw);
	if (!normalized) {
		return { ok: false, error: "invalid_url" };
	}

	await chrome.storage.local.set({
		[STORAGE_KEYS.substackEditorUrl]: normalized
	});
	return { ok: true, editorUrl: normalized };
}

function normalizeSubstackEditorUrl(value) {
	const text = String(value || "")
		.trim()
		.replace(/[，,。；;]+$/g, "")
		.trim();
	if (!text) {
		return "";
	}

	try {
		const url = new URL(text);
		if (url.protocol !== "https:") {
			return "";
		}
		if (!isPersonalSubstackHost(url.hostname)) {
			return "";
		}
		const path = url.pathname.replace(/\/+$/g, "");
		// Accept the legacy saved `/publish/post` form only so it can be migrated
		// to the personal dashboard. It is never treated as a writable editor.
		if (path !== "/publish/home" && path !== "/publish/post" && !isSubstackEditorPath(path)) {
			return "";
		}
		return `${url.origin}${SUBSTACK_DASHBOARD_PATH}`;
	} catch {
		return "";
	}
}

function isPersonalSubstackEditorUrl(value) {
	const normalized = normalizeSubstackEditorUrl(value);
	if (!normalized) {
		return false;
	}
	try {
		return isPersonalSubstackHost(new URL(normalized).hostname);
	} catch {
		return false;
	}
}

function isPersonalSubstackHost(hostname) {
	return typeof hostname === "string"
		&& hostname.endsWith(".substack.com")
		&& hostname !== "substack.com";
}

function isSubstackEditorPath(pathname) {
	return /^\/publish\/posts?\/(?!(?:drafts?|home)\/?$)[^/]+\/?$/i.test(pathname);
}

function isPersonalSubstackPublisherUrl(value) {
	try {
		const url = new URL(value);
		const path = url.pathname.replace(/\/+$/g, "");
		return url.protocol === "https:"
			&& isPersonalSubstackHost(url.hostname)
			&& (path === "/publish/home" || isSubstackEditorPath(path));
	} catch {
		return false;
	}
}

function compareSubstackPublisherTabs(left, right) {
	if (Boolean(left.active) !== Boolean(right.active)) {
		return left.active ? -1 : 1;
	}
	return Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0);
}

function isAllowedSubstackTaskUrl(value) {
	return isPersonalSubstackPublisherUrl(value);
}

function getSubstackTaskUrlFailure(value) {
	try {
		const url = new URL(value);
		if (url.hostname === "substack.com") {
			return "substack_redirected_to_public_site";
		}
	} catch {
		// Fall through to the generic unsafe destination reason.
	}
	return "substack_not_personal_publisher";
}

async function invalidateSubstackPublisherUrl(value) {
	const stored = await chrome.storage.local.get({
		[STORAGE_KEYS.substackEditorUrl]: ""
	});
	if (normalizeSubstackEditorUrl(stored[STORAGE_KEYS.substackEditorUrl]) === normalizeSubstackEditorUrl(value)) {
		await chrome.storage.local.remove(STORAGE_KEYS.substackEditorUrl);
	}
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

if (globalThis.__OTP_COMPANION_BACKGROUND_TEST__ === true) {
	globalThis.OTPCompanionBackground = {
		clearTask,
		closeBridge,
		connectBridge,
		drainTaskQueue,
		getConnectionState: () => ({ ...connectionState }),
		getSchedulerSnapshot: () => ({
			activeTaskIdsByPlatform: Object.fromEntries(activeTaskIdByPlatform),
			queuedTaskIdsByPlatform: Object.fromEntries(
				[...queuedTaskIdsByPlatform.entries()].map(([platform, taskIds]) => [platform, [...taskIds]])
			),
			tasks: [...tasksById.values()].map((task) => ({
				id: task.id,
				platform: task.platform,
				status: task.status,
				tabId: task.tabId
			}))
		}),
		handleSubstackTaskNavigation: async (taskId, url) => {
			const task = tasksById.get(taskId);
			if (!task || task.platform !== "substack") {
				return false;
			}
			if (isAllowedSubstackTaskUrl(url)) {
				return true;
			}
			await invalidateSubstackPublisherUrl(task.editorUrl);
			await settleTask(task.id, { status: "failed", reason: getSubstackTaskUrlFailure(url) });
			return false;
		},
		handleTaskStage,
		handleTabRemoved,
		handleTaskResult,
		importDraft,
		isTaskExpired,
		normalizeSubstackEditorUrl,
		reconnectBridge
	};
}
