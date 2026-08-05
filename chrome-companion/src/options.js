const DEFAULT_BRIDGE_PORT = 27127;
const STORAGE_KEYS = {
	port: "bridgePort",
	token: "bridgeToken"
};

const portInput = document.getElementById("port");
const tokenInput = document.getElementById("token");
const messageEl = document.getElementById("message");
const statusDotEl = document.getElementById("status-dot");
const statusMainEl = document.getElementById("status-main");
const statusDetailEl = document.getElementById("status-detail");
const STATUS_REFRESH_INTERVAL_MS = 3000;
let statusTimer = null;

document.getElementById("save").addEventListener("click", saveAndConnect);
document.getElementById("show-token").addEventListener("click", () => {
	tokenInput.type = tokenInput.type === "password" ? "text" : "password";
});
document.getElementById("status").addEventListener("click", refreshStatus);

void restore();

async function restore() {
	const settings = await chrome.storage.local.get({
		[STORAGE_KEYS.port]: DEFAULT_BRIDGE_PORT,
		[STORAGE_KEYS.token]: ""
	});
	portInput.value = String(settings[STORAGE_KEYS.port]);
	tokenInput.value = settings[STORAGE_KEYS.token];
	await refreshStatus();
	startStatusPolling();
}

async function saveAndConnect() {
	const port = Number(portInput.value);
	if (!Number.isInteger(port) || port < 1024 || port > 65535) {
		showMessage("端口必须是 1024 到 65535 之间的整数。");
		return;
	}

	const token = tokenInput.value.trim();
	if (!token) {
		showMessage("请先从 Obsidian 插件设置复制连接令牌。");
		return;
	}

	await chrome.storage.local.set({
		[STORAGE_KEYS.port]: port,
		[STORAGE_KEYS.token]: token
	});
	const response = await chrome.runtime.sendMessage({ type: "bridge.connect" });
	renderState(response?.state);
	showMessage("已保存连接设置。");
}

async function refreshStatus() {
	const response = await chrome.runtime.sendMessage({ type: "bridge.status" });
	renderState(response?.state);
}

function getStateView(state) {
	if (!state) {
		return {
			tone: "offline",
			label: "状态未知",
			detail: "未获得连接状态。"
		};
	}

	if (state.connected) {
		const connectedAt = state.lastConnectedAt
			? `，连接时间 ${new Date(state.lastConnectedAt).toLocaleTimeString()}`
			: "";
		return {
			tone: "connected",
			label: "已连接",
			detail: `Chrome companion 已连接 Obsidian 本地 bridge${connectedAt}。`
		};
	}

	if (state.lastError === "missing_token") {
		return {
			tone: "offline",
			label: "未连接",
			detail: "缺少连接令牌，请从 Obsidian 插件设置复制。"
		};
	}

	if (state.lastError) {
		return {
			tone: "waiting",
			label: "连接中断",
			detail: `正在等待 Obsidian 本地 bridge：${state.lastError}。`
		};
	}

	return {
		tone: "waiting",
		label: "等待连接",
		detail: "尚未连接 Obsidian 本地 bridge。"
	};
}

function renderState(state) {
	const view = getStateView(state);
	statusDotEl.className = `status-dot ${view.tone}`;
	statusMainEl.textContent = view.label;
	statusDetailEl.textContent = view.detail;
}

function showMessage(text) {
	messageEl.textContent = text;
}

function startStatusPolling() {
	if (statusTimer) {
		return;
	}
	statusTimer = window.setInterval(() => {
		void refreshStatus();
	}, STATUS_REFRESH_INTERVAL_MS);
}
