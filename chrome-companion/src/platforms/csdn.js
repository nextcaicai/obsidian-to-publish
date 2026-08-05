(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "csdn",
		hosts: ["editor.csdn.net"],
		bodyFormat: "markdown",
		insertMode: "markdown-page-upload-assets",
		preferPaste: true,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: false,
		replaceAssetUrlsInMarkdown: false,
		pageUploadScript: "src/page-csdn-upload.js",
		pageUploadScriptVersion: "v1",
		pageUploadRequestSource: "OTP_COMPANION_CSDN_UPLOAD_REQUEST_V1",
		pageUploadResponseSource: "OTP_COMPANION_CSDN_UPLOAD_RESPONSE_V1",
		pageUploadConcurrency: 2,
		pageUploadRetries: 2,
		uploadQueueConcurrency: 2,
		uploadQueueRetries: 2,
		uploadQueueRetryDelayMs: 1200,
		pageUploadOptions: {
			appName: "blog",
			imageTemplate: "direct",
			env: "prod",
			currentLine: "external"
		},
		cleanupUploadedMarkerAltText: true,
		uploadedImageUrlPattern: /csdnimg\.cn/i,
		imageUploadWaitMs: 60000,
		markerWaitMs: 8000,
		markerPollMs: 300,
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
