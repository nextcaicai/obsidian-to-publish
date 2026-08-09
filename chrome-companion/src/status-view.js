(function initCompanionStatusView(root) {
	function getChromeCompanionStateView(state) {
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

		if (state.connecting) {
			return {
				tone: "waiting",
				label: "连接中",
				detail: "正在连接 Obsidian 本地 bridge。"
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
				tone: "offline",
				label: "未连接",
				detail: "连接失败，请确认 Obsidian 本地 bridge 已启动，并检查端口和令牌是否一致。"
			};
		}

		return {
			tone: "offline",
			label: "未连接",
			detail: "尚未连接 Obsidian 本地 bridge。"
		};
	}

	const api = { getChromeCompanionStateView };
	root.OTPCompanionStatusView = api;

	if (typeof module === "object" && module.exports) {
		module.exports = api;
	}
})(globalThis);
