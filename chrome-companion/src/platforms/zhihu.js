(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "zhihu",
		hosts: ["www.zhihu.com", "zhuanlan.zhihu.com"],
		bodyFormat: "rich-html",
		preferPaste: true,
		includeFilesInMainPaste: true,
		pasteFilesAfterText: false,
		omitAssets: true,
		titleSelectors: [
			"textarea[placeholder*='标题']",
			"input[placeholder*='标题']",
			"[contenteditable='true'][data-placeholder*='标题']",
			"[contenteditable='true'][aria-label*='标题']"
		],
		bodySelectors: [
			".DraftEditor-root .public-DraftEditor-content[contenteditable='true']",
			".public-DraftEditor-content[contenteditable='true']",
			".RichText [contenteditable='true']",
			".ProseMirror[contenteditable='true']",
			"[contenteditable='true'][role='textbox']"
		]
	});
})();
