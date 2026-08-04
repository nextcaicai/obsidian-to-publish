(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "juejin",
		hosts: ["juejin.cn"],
		bodyFormat: "markdown",
		preferPaste: true,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: true,
		titleSelectors: [
			"input[placeholder*='标题']",
			"textarea[placeholder*='标题']",
			"input[placeholder*='请输入文章标题']",
			"[contenteditable='true'][data-placeholder*='标题']"
		],
		bodySelectors: [
			".bytemd-editor .cm-content[contenteditable='true']",
			".markdown-editor .cm-content[contenteditable='true']",
			".cm-content[contenteditable='true']",
			".CodeMirror textarea",
			".bytemd-editor textarea",
			"textarea"
		]
	});
})();
