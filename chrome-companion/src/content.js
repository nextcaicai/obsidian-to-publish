const handledTaskIds = new Set();

void rememberCurrentSubstackEditorUrl();
void initCompanionPanel();
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || typeof message !== "object") {
		return false;
	}

	if (message.type === "task.deliver") {
		void handleDeliveredTask(message.task)
			.then((handled) => sendResponse({ ok: true, handled }))
			.catch((error) => {
				console.error(error);
				sendResponse({
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		return true;
	}

	return false;
});

async function initCompanionPanel() {
	const companion = globalThis.OTPCompanion;
	const adapter = companion.getPlatformAdapter();
	if (!adapter || !isAdapterFrameAllowed(adapter)) {
		return;
	}

	const response = await chrome.runtime.sendMessage({
		type: "task.getLatest",
		platform: adapter.id
	});
	const task = response?.task;
	if (!task || task.platform !== adapter.id) {
		return;
	}

	await handleDeliveredTask(task);
}

async function rememberCurrentSubstackEditorUrl() {
	if (window.top !== window || !isSubstackPublisherUrl(window.location.href)) {
		return;
	}

	try {
		await chrome.runtime.sendMessage({
			type: "substack.rememberEditorUrl",
			url: window.location.href
		});
	} catch {
		// The background service worker may be restarting; import still works without this hint.
	}
}

function isSubstackPublisherUrl(value) {
	try {
		const url = new URL(value);
		const path = url.pathname.replace(/\/+$/g, "");
		return url.protocol === "https:"
			&& url.hostname.endsWith(".substack.com")
			&& (path === "/publish" || path.startsWith("/publish/"));
	} catch {
		return false;
	}
}

async function handleDeliveredTask(task) {
	const companion = globalThis.OTPCompanion;
	const adapter = companion.getPlatformAdapter();
	if (!adapter || !isAdapterFrameAllowed(adapter)) {
		return false;
	}
	if (!task || task.platform !== adapter.id) {
		return false;
	}
	if (handledTaskIds.has(task.id)) {
		return true;
	}
	handledTaskIds.add(task.id);

	const panel = renderPanel(task, adapter);
	void autoInsertDraft(task, adapter, panel);
	return true;
}

function isAdapterFrameAllowed(adapter) {
	if (window.top !== window && adapter.frameScope !== "child") {
		return false;
	}
	if (window.top === window && adapter.frameScope === "child") {
		return false;
	}
	return true;
}

function renderPanel(task, adapter) {
	const companion = globalThis.OTPCompanion;
	document.getElementById(companion.PANEL_ID)?.remove();

	const panel = document.createElement("section");
	panel.id = companion.PANEL_ID;
	panel.style.cssText = [
		"position:fixed",
		"right:16px",
		"bottom:16px",
		"z-index:2147483647",
		"width:min(360px,calc(100vw - 32px))",
		"box-sizing:border-box",
		"padding:14px",
		"border:1px solid rgba(15,23,42,.18)",
		"border-radius:8px",
		"background:#fff",
		"box-shadow:0 12px 32px rgba(15,23,42,.18)",
		"color:#111827",
		"font:13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"
	].join(";");

	const title = document.createElement("div");
	title.textContent = task.package?.article?.title || "Obsidian draft";
	title.style.cssText = "font-weight:600;margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
	panel.appendChild(title);

	const meta = document.createElement("div");
	meta.textContent = `${adapter.id} draft package received from Obsidian`;
	meta.style.cssText = "color:#475569;margin-bottom:10px;";
	panel.appendChild(meta);

	const controls = document.createElement("div");
	controls.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
	panel.appendChild(controls);

	const insertButton = createButton("尝试填入");
	insertButton.addEventListener("click", async () => {
		const result = await companion.insertDraftWithAdapter(task, adapter);
		showInlineStatus(panel, getInsertResultMessage(result));
	});
	controls.appendChild(insertButton);

	const copyButton = createButton("复制 Markdown");
	copyButton.addEventListener("click", async () => {
		await navigator.clipboard.writeText(task.package?.article?.markdown || "");
		showInlineStatus(panel, "已复制 Markdown。");
	});
	controls.appendChild(copyButton);

	const closeButton = createButton("关闭");
	closeButton.addEventListener("click", async () => {
		await chrome.runtime.sendMessage({
			type: "task.clearLatest",
			platform: adapter.id
		});
		panel.remove();
	});
	controls.appendChild(closeButton);

	document.documentElement.appendChild(panel);
	return panel;
}

function createButton(text) {
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = text;
	button.style.cssText = [
		"appearance:none",
		"border:1px solid #cbd5e1",
		"border-radius:6px",
		"background:#f8fafc",
		"color:#111827",
		"padding:6px 10px",
		"font:inherit",
		"cursor:pointer"
	].join(";");
	return button;
}

function showInlineStatus(panel, text) {
	let status = panel.querySelector("[data-companion-status]");
	if (!status) {
		status = document.createElement("div");
		status.setAttribute("data-companion-status", "true");
		status.style.cssText = "margin-top:10px;color:#334155;";
		panel.appendChild(status);
	}
	status.textContent = text;
}

async function autoInsertDraft(task, adapter, panel) {
	const companion = globalThis.OTPCompanion;
	const sessionKey = `obsidian-to-publish-inserted:${task.id}`;
	if (sessionStorage.getItem(sessionKey) === "true") {
		showInlineStatus(panel, "该草稿已在当前标签页尝试写入。");
		return;
	}

	const startedAt = Date.now();
	let titleAlreadyInserted = false;
	while (Date.now() - startedAt < (adapter.autoInsertTimeoutMs ?? companion.AUTO_INSERT_TIMEOUT_MS)) {
		const result = await companion.insertDraftWithAdapter(task, adapter, {
			skipTitle: titleAlreadyInserted
		});
		titleAlreadyInserted = titleAlreadyInserted || result.titleInserted;
		if (result.bodyInserted) {
			sessionStorage.setItem(sessionKey, "true");
			showInlineStatus(panel, getInsertResultMessage({
				...result,
				titleInserted: titleAlreadyInserted
			}));
			return;
		}

		showInlineStatus(panel, titleAlreadyInserted ? "已写入标题，等待正文编辑器加载..." : "等待编辑器加载...");
		await companion.delay(companion.AUTO_INSERT_INTERVAL_MS);
	}

	showInlineStatus(panel, "未找到可写入的编辑区域，请点击正文编辑器后点“尝试填入”。");
}

function getInsertResultMessage(result) {
	const imageSuffix = getImageResultSuffix(result);
	if (result.titleInserted && result.bodyInserted) {
		return `已尝试写入标题和正文${imageSuffix}。`;
	}

	if (result.bodyInserted) {
		return `已尝试写入正文${imageSuffix}，标题可能需要手动填写。`;
	}

	if (result.titleInserted) {
		return "已尝试写入标题，正文未找到可写入区域。";
	}

	return "未找到可写入的编辑区域，请先点击正文编辑器后重试。";
}

function getImageResultSuffix(result) {
	if (!result.imageTotal) {
		return result.imageIncluded ? "，图片已随粘贴数据发送" : "";
	}

	if (result.imageDelivery === "paste") {
		if (result.imageFailed > 0) {
			return `，图片已随粘贴数据发送 ${result.imageUploaded}/${result.imageTotal}，失败图片需手动上传`;
		}

		return `，图片已随粘贴数据发送 ${result.imageUploaded}/${result.imageTotal}`;
	}

	if (result.imageDelivery === "page-marker-upload") {
		if (result.imageFailed > 0) {
			return `，图片已按正文位置上传 ${result.imageUploaded}/${result.imageTotal}，失败图片需手动处理`;
		}

		return `，图片已按正文位置上传 ${result.imageUploaded}/${result.imageTotal}`;
	}

	if (result.imageDelivery === "editor-file-input" || result.imageDelivery === "editor-position-paste") {
		if (result.imageFailed > 0) {
			return `，图片已按正文位置插入 ${result.imageUploaded}/${result.imageTotal}，失败位置已保留提示`;
		}

		return `，图片已按正文位置插入 ${result.imageUploaded}/${result.imageTotal}`;
	}

	if (result.imageFailed > 0) {
		return `，图片已上传 ${result.imageUploaded}/${result.imageTotal}，失败处已保留标记`;
	}

	return `，图片已上传 ${result.imageUploaded}/${result.imageTotal}`;
}
