const PLATFORM_BY_HOST = [
	{ id: "x", hosts: ["x.com", "twitter.com"] },
	{ id: "csdn", hosts: ["editor.csdn.net"] },
	{ id: "juejin", hosts: ["juejin.cn"] },
	{ id: "zhihu", hosts: ["www.zhihu.com", "zhuanlan.zhihu.com"] },
	{ id: "substack", hosts: ["substack.com"] },
	{ id: "xiaohongshu", hosts: ["creator.xiaohongshu.com"] },
	{ id: "bilibili", hosts: ["member.bilibili.com"] },
	{ id: "zhishixingqiu", hosts: ["wx.zsxq.com"] }
];

const PANEL_ID = "obsidian-to-publish-companion-panel";
const AUTO_INSERT_TIMEOUT_MS = 20000;
const AUTO_INSERT_INTERVAL_MS = 700;
const RICH_HTML_PLATFORMS = new Set(["zhihu", "substack", "bilibili", "zhishixingqiu"]);

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

	const panel = renderPanel(task, platform);
	void autoInsertDraft(task, platform, panel);
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
		const result = tryInsertDraft(task, platform);
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
		await chrome.runtime.sendMessage({ type: "task.clearLatest" });
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

async function autoInsertDraft(task, platform, panel) {
	const sessionKey = `obsidian-to-publish-inserted:${task.id}`;
	if (sessionStorage.getItem(sessionKey) === "true") {
		showInlineStatus(panel, "该草稿已在当前标签页尝试写入。");
		return;
	}

	const startedAt = Date.now();
	while (Date.now() - startedAt < AUTO_INSERT_TIMEOUT_MS) {
		const result = tryInsertDraft(task, platform);
		if (result.bodyInserted || result.titleInserted) {
			sessionStorage.setItem(sessionKey, "true");
			showInlineStatus(panel, getInsertResultMessage(result));
			return;
		}

		showInlineStatus(panel, "等待编辑器加载...");
		await delay(AUTO_INSERT_INTERVAL_MS);
	}

	showInlineStatus(panel, "未找到可写入的编辑区域，请点击正文编辑器后点“尝试填入”。");
}

function tryInsertDraft(task, platform) {
	const title = task.package?.article?.title || "";
	const payload = getDraftPayload(task, platform);
	const titleInserted = tryInsertTitle(title);
	const bodyInserted = tryInsertBody(payload);

	return {
		titleInserted,
		bodyInserted
	};
}

function tryInsertTitle(title) {
	if (!title.trim()) {
		return false;
	}

	const target = findTitleWritableElement();
	if (!target) {
		return false;
	}

	return insertIntoWritableElement(target, {
		text: title,
		html: ""
	});
}

function tryInsertBody(payload) {
	if (!payload.text.trim() && !payload.html.trim()) {
		return false;
	}

	const target = getFocusedBodyElement() || findLargestBodyElement();
	if (!target) {
		return false;
	}

	return insertIntoWritableElement(target, payload);
}

function insertIntoWritableElement(target, payload) {
	target.focus();
	if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
		insertIntoTextControl(target, payload.text);
		return true;
	}

	const html = payload.html.trim();
	const inserted = html
		? document.execCommand("insertHTML", false, html)
		: document.execCommand("insertText", false, payload.text);
	dispatchInputEvent(target, payload.text);
	return inserted;
}

function insertIntoTextControl(target, text) {
	const start = target.selectionStart ?? target.value.length;
	const end = target.selectionEnd ?? target.value.length;
	target.value = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
	target.selectionStart = start + text.length;
	target.selectionEnd = start + text.length;
	dispatchInputEvent(target, text);
}

function dispatchInputEvent(target, text) {
	target.dispatchEvent(new InputEvent("input", {
		bubbles: true,
		cancelable: true,
		inputType: "insertText",
		data: text
	}));
}

function getDraftPayload(task, platform) {
	const article = task.package?.article || {};
	const markdown = article.markdown || article.text || "";
	if (!RICH_HTML_PLATFORMS.has(platform.id)) {
		return {
			text: markdown,
			html: ""
		};
	}

	return {
		text: article.text || markdown,
		html: extractSafeHtmlFragment(article.html || "")
	};
}

function extractSafeHtmlFragment(html) {
	if (!html.trim()) {
		return "";
	}

	const template = document.createElement("template");
	template.innerHTML = html;
	for (const element of Array.from(template.content.querySelectorAll("script,style,iframe,object,embed"))) {
		element.remove();
	}

	const sourceSection = template.content.querySelector("section[data-source='obsidian-to-publish']");
	return (sourceSection?.innerHTML || template.innerHTML).trim();
}

function getFocusedBodyElement() {
	const active = document.activeElement;
	if (isWritableElement(active) && !isLikelyTitleElement(active)) {
		return active;
	}

	return null;
}

function findLargestBodyElement() {
	return getWritableCandidates()
		.filter(({ element, rect }) => !isLikelyTitleElement(element) && rect.width > 120 && rect.height > 40)
		.sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.element || null;
}

function findTitleWritableElement() {
	const titleCandidate = getWritableCandidates()
		.find(({ element }) => isLikelyTitleElement(element));
	return titleCandidate?.element || null;
}

function getWritableCandidates() {
	return Array.from(document.querySelectorAll("textarea,input,[contenteditable='true'],[role='textbox']"))
		.filter(isWritableElement)
		.map((element) => ({
			element,
			rect: element.getBoundingClientRect()
		}))
		.filter(({ rect }) => rect.width > 40 && rect.height > 20)
		.sort((a, b) => a.rect.top - b.rect.top);
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

	return element.isContentEditable || element.getAttribute("role") === "textbox";
}

function isLikelyTitleElement(element) {
	const text = [
		element.getAttribute("placeholder"),
		element.getAttribute("aria-label"),
		element.getAttribute("data-placeholder"),
		element.getAttribute("name"),
		element.getAttribute("id"),
		element.className
	].join(" ");

	return /title|headline|subject|标题|题目/i.test(text);
}

function getInsertResultMessage(result) {
	if (result.titleInserted && result.bodyInserted) {
		return "已尝试写入标题和正文。";
	}

	if (result.bodyInserted) {
		return "已尝试写入正文，标题可能需要手动填写。";
	}

	if (result.titleInserted) {
		return "已尝试写入标题，正文未找到可写入区域。";
	}

	return "未找到可写入的编辑区域，请先点击正文编辑器后重试。";
}

function delay(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function getCurrentPlatform() {
	const host = window.location.hostname;
	return PLATFORM_BY_HOST.find((platform) => {
		if (platform.id === "substack") {
			return host === "substack.com" || host.endsWith(".substack.com");
		}

		return platform.hosts.includes(host);
	}) || null;
}
