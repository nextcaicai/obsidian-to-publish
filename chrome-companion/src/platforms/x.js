(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "x",
		hosts: ["x.com", "twitter.com"],
		bodyFormat: "markdown",
		insertMode: "markdown-page-upload-markers",
		pageScriptWritesBody: true,
		pageUploadDependencies: ["src/page-editor-order.js", "src/page-x-markdown.js"],
		preferPaste: false,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: false,
		replaceAssetUrlsInMarkdown: false,
		pageUploadScript: "src/page-x-upload.js",
		pageUploadScriptVersion: "v5",
		pageUploadRequestSource: "OTP_COMPANION_X_UPLOAD_REQUEST_V1",
		pageUploadResponseSource: "OTP_COMPANION_X_UPLOAD_RESPONSE_V1",
		imageUploadWaitMs: 90000,
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
