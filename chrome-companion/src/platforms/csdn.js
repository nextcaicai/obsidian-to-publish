(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "csdn",
		hosts: ["editor.csdn.net"],
		bodyFormat: "markdown",
		insertMode: "markdown-sequential-assets",
		preferPaste: true,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: false,
		replaceAssetUrlsInMarkdown: false,
		filePasteDelayMs: 1800,
		titleClickText: ["【无标题】", "无标题"],
		titleSelectors: [
			"input[placeholder*='标题']",
			"textarea[placeholder*='标题']",
			"[class*='title' i] input",
			"[class*='title' i] textarea",
			"[contenteditable='true'][data-placeholder*='标题']",
			"[role='textbox'][aria-label*='标题']",
			"input[maxlength='100']"
		],
		bodySelectors: [
			".cm-content[contenteditable='true']",
			".CodeMirror textarea",
			".bytemd-editor textarea",
			"textarea.editor",
			"textarea",
			"[contenteditable='true'][role='textbox']"
		]
	});
})();
