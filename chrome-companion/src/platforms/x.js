(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "x",
		hosts: ["x.com", "twitter.com"],
		bodyFormat: "markdown",
		preferPaste: false,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: false,
		replaceAssetUrlsInMarkdown: false,
		omitAssets: true,
		titleSelectors: [
			"input[placeholder*='Title']",
			"textarea[placeholder*='Title']",
			"[data-testid*='title' i][contenteditable='true']",
			"[aria-label*='Title' i][contenteditable='true']",
			"[contenteditable='true'][data-placeholder*='Title' i]"
		],
		bodySelectors: [
			"[data-testid*='article' i] [contenteditable='true']",
			".public-DraftEditor-content[contenteditable='true']",
			"[contenteditable='true'][role='textbox']",
			"[role='textbox'][contenteditable='true']"
		]
	});
})();
