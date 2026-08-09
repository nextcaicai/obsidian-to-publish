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
	if (settings[STORAGE_KEYS.token]) {
		await connectAndRender();
	} else {
		await refreshStatus();
	}
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
	await connectAndRender();
	showMessage("已保存连接设置。");
}

async function connectAndRender() {
	const response = await chrome.runtime.sendMessage({ type: "bridge.connect" });
	renderState(response?.state);
}

async function refreshStatus() {
	const response = await chrome.runtime.sendMessage({ type: "bridge.status" });
	renderState(response?.state);
}

function getStateView(state) {
	return globalThis.OTPCompanionStatusView.getChromeCompanionStateView(state);
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
