(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "juejin",
		hosts: ["juejin.cn"],
		bodyFormat: "markdown",
		insertMode: "markdown-page-upload-assets",
		preferPaste: true,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: false,
		replaceAssetUrlsInMarkdown: false,
		pageUploadScript: "src/page-juejin-upload.js",
		pageUploadScriptVersion: "v3",
		pageUploadRequestSource: "OTP_COMPANION_JUEJIN_UPLOAD_REQUEST_V3",
		pageUploadResponseSource: "OTP_COMPANION_JUEJIN_UPLOAD_RESPONSE_V3",
		pageUploadConcurrency: 2,
		pageUploadRetries: 2,
		uploadQueueConcurrency: 2,
		uploadQueueRetries: 2,
		uploadQueueRetryDelayMs: 1200,
		uploadImagesViaFileInput: true,
		clickUploadButtonBeforeInput: true,
		uploadInputSelectors: [
			".bytemd input[type='file']",
			".markdown-editor input[type='file']",
			"input[type='file'][accept*='image']",
			"input[type='file'][accept*='.png']",
			"input[type='file'][accept*='.jpg']",
			"input[type='file'][accept*='.jpeg']",
			"input[type='file']"
		],
		uploadInputExcludeClosestSelectors: [
			".coverselector_container",
			".article-importer"
		],
		uploadButtonSelectors: [
			".bytemd-toolbar-left .bytemd-toolbar-icon[bytemd-tippy-path='5']",
			"button[title*='图片']",
			"button[aria-label*='图片']",
			"[role='button'][title*='图片']",
			"[role='button'][aria-label*='图片']",
			".bytemd-toolbar-icon[title*='图片']",
			".bytemd-toolbar-icon[aria-label*='图片']"
		],
		uploadButtonText: ["图片"],
		uploadInputCreateDelayMs: 800,
		relocateUploadedImageMarkdown: true,
		uploadedImageUrlPattern: /juejin|byteimg|xtjj/i,
		uploadSearchRootSelector: ".bytemd,.markdown-editor,.cm-editor",
		searchDocumentTextForUploads: true,
		imageUploadWaitMs: 60000,
		markerWaitMs: 5000,
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
