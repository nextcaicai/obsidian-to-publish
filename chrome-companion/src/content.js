const PLATFORM_BY_HOST = [
	{ id: "x", hosts: ["x.com", "twitter.com"] },
	{ id: "csdn", hosts: ["editor.csdn.net"] },
	{ id: "juejin", hosts: ["juejin.cn"] },
	{ id: "zhihu", hosts: ["www.zhihu.com"] },
	{ id: "substack", hosts: ["substack.com"] },
	{ id: "xiaohongshu", hosts: ["creator.xiaohongshu.com"] },
	{ id: "bilibili", hosts: ["member.bilibili.com"] },
	{ id: "zhishixingqiu", hosts: ["wx.zsxq.com"] }
];

const PANEL_ID = "obsidian-to-publish-companion-panel";

void initCompanionPanel();

async function initCompanionPanel() {
	const platform = getCurrentPlatform();
	if (!platform) {
		return;
	}

	const response = await chrome.runtime.sendMessage({ type: "task.getLatest" });
	const task = response?.task;
	if (!task || task.platform !== platform.id) {
		return;
	}

	renderPanel(task, platform);
}

function renderPanel(task, platform) {
	document.getElementById(PANEL_ID)?.remove();

	const panel = document.createElement("section");
	panel.id = PANEL_ID;
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
	meta.textContent = `${platform.id} draft package received from Obsidian`;
	meta.style.cssText = "color:#475569;margin-bottom:10px;";
	panel.appendChild(meta);

	const controls = document.createElement("div");
	controls.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
	panel.appendChild(controls);

	const insertButton = createButton("尝试填入");
	insertButton.addEventListener("click", async () => {
		const inserted = tryInsertMarkdown(task.package?.article?.markdown || "");
		showInlineStatus(panel, inserted ? "已尝试写入当前编辑器。" : "未找到可写入的编辑区域，请先点击正文编辑器后重试。");
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
		await chrome.runtime.sendMessage({ type: "task.clearLatest" });
		panel.remove();
	});
	controls.appendChild(closeButton);

	document.documentElement.appendChild(panel);
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

function tryInsertMarkdown(markdown) {
	if (!markdown.trim()) {
		return false;
	}

	const target = getFocusedWritableElement() || findLargestWritableElement();
	if (!target) {
		return false;
	}

	target.focus();
	if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
		insertIntoTextControl(target, markdown);
		return true;
	}

	const inserted = document.execCommand("insertText", false, markdown);
	target.dispatchEvent(new InputEvent("input", {
		bubbles: true,
		cancelable: true,
		inputType: "insertText",
		data: markdown
	}));
	return inserted;
}

function insertIntoTextControl(target, text) {
	const start = target.selectionStart ?? target.value.length;
	const end = target.selectionEnd ?? target.value.length;
	target.value = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
	target.selectionStart = start + text.length;
	target.selectionEnd = start + text.length;
	target.dispatchEvent(new InputEvent("input", {
		bubbles: true,
		cancelable: true,
		inputType: "insertText",
		data: text
	}));
}

function getFocusedWritableElement() {
	const active = document.activeElement;
	if (isWritableElement(active)) {
		return active;
	}

	return null;
}

function findLargestWritableElement() {
	const candidates = Array.from(document.querySelectorAll("textarea,input,[contenteditable='true']"))
		.filter(isWritableElement)
		.map((element) => ({
			element,
			rect: element.getBoundingClientRect()
		}))
		.filter(({ rect }) => rect.width > 80 && rect.height > 30)
		.sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));

	return candidates[0]?.element || null;
}

function isWritableElement(element) {
	if (!(element instanceof HTMLElement)) {
		return false;
	}

	if (element instanceof HTMLTextAreaElement) {
		return !element.disabled && !element.readOnly;
	}

	if (element instanceof HTMLInputElement) {
		return !element.disabled && !element.readOnly && ["", "text", "search", "url"].includes(element.type);
	}

	return element.isContentEditable;
}

function getCurrentPlatform() {
	const host = window.location.hostname;
	return PLATFORM_BY_HOST.find((platform) => platform.hosts.includes(host)) || null;
}
