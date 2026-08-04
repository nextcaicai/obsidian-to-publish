const DEFAULT_BRIDGE_PORT = 27127;
const STORAGE_KEYS = {
	port: "bridgePort",
	token: "bridgeToken"
};

const portInput = document.getElementById("port");
const tokenInput = document.getElementById("token");
const messageEl = document.getElementById("message");

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
	showMessage(formatState(response?.state));
}

async function refreshStatus() {
	const response = await chrome.runtime.sendMessage({ type: "bridge.status" });
	showMessage(formatState(response?.state));
}

function formatState(state) {
	if (!state) {
		return "未获得连接状态。";
	}

	if (state.connected) {
		return "已连接 Obsidian 本地 bridge。";
	}

	if (state.lastError === "missing_token") {
		return "未连接：缺少连接令牌。";
	}

	if (state.lastError) {
		return `未连接：${state.lastError}。`;
	}

	return "未连接。";
}

function showMessage(text) {
	messageEl.textContent = text;
}
