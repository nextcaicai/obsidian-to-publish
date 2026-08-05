(function () {
	const fallbackBodySelectors = [
		".ProseMirror[contenteditable='true']",
		".public-DraftEditor-content[contenteditable='true']",
		".cm-content[contenteditable='true']",
		"textarea",
		"[contenteditable='true'][role='textbox']",
		"[role='textbox'][contenteditable='true']",
		"[contenteditable='true']"
	];
	const fallbackTitleSelectors = [
		"input[placeholder*='标题']",
		"textarea[placeholder*='标题']",
		"input[placeholder*='Title']",
		"textarea[placeholder*='Title']",
		"[contenteditable='true'][data-placeholder*='标题']",
		"[contenteditable='true'][data-placeholder*='Title' i]"
	];

	for (const adapter of [
		{ id: "xiaohongshu", hosts: ["creator.xiaohongshu.com"], bodyFormat: "plain-text" },
		{ id: "bilibili", hosts: ["member.bilibili.com"], bodyFormat: "rich-html" },
		{ id: "zhishixingqiu", hosts: ["wx.zsxq.com"], bodyFormat: "rich-html" }
	]) {
		globalThis.OTPCompanion.registerPlatformAdapter({
			...adapter,
			preferPaste: true,
			includeFilesInMainPaste: true,
			pasteFilesAfterText: false,
			autoInsertTimeoutMs: 90000,
			titleSelectors: fallbackTitleSelectors,
			bodySelectors: fallbackBodySelectors
		});
	}
})();
