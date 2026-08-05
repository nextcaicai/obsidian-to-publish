(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "zhishixingqiu",
		hosts: ["wx.zsxq.com"],
		bodyFormat: "rich-html",
		preferPaste: true,
		includeFilesInMainPaste: true,
		pasteFilesAfterText: false,
		autoInsertTimeoutMs: 90000,
		titleSelectors: [
			"input[placeholder*='标题']",
			"textarea[placeholder*='标题']",
			"[contenteditable='true'][data-placeholder*='标题']"
		],
		bodySelectors: [
			".ProseMirror[contenteditable='true']",
			"[contenteditable='true'][role='textbox']",
			"[role='textbox'][contenteditable='true']",
			"[contenteditable='true']"
		]
	});
})();
