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
		{
			id: "xiaohongshu",
			hosts: ["creator.xiaohongshu.com"],
			bodyFormat: "rich-html",
			insertMode: "rich-html-placeholder-assets",
			includeFilesInMainPaste: false,
			pasteFilesAfterText: false,
			imageUploadWaitMs: 60000,
			markerWaitMs: 10000,
			filePasteDelayMs: 1200
		},
		{
			id: "bilibili",
			hosts: ["member.bilibili.com"],
			frameScope: "child",
			bodyFormat: "rich-html",
			insertMode: "rich-html-placeholder-assets",
			includeFilesInMainPaste: false,
			pasteFilesAfterText: false,
			imageUploadWaitMs: 60000,
			markerWaitMs: 10000,
			filePasteDelayMs: 1200,
			titleSelectors: ["textarea.title-input__inner", "textarea[placeholder*='标题']"],
			bodySelectors: [".tiptap.ProseMirror[contenteditable='true']", ".ProseMirror[contenteditable='true']"]
		},
		{ id: "zhishixingqiu", hosts: ["wx.zsxq.com"], bodyFormat: "rich-html" }
	]) {
		globalThis.OTPCompanion.registerPlatformAdapter({
			...adapter,
			preferPaste: true,
			includeFilesInMainPaste: adapter.includeFilesInMainPaste ?? true,
			pasteFilesAfterText: adapter.pasteFilesAfterText ?? false,
			autoInsertTimeoutMs: 90000,
			titleSelectors: adapter.titleSelectors || fallbackTitleSelectors,
			bodySelectors: adapter.bodySelectors || fallbackBodySelectors
		});
	}
})();
