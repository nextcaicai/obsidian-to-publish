(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "xiaohongshu",
		hosts: ["creator.xiaohongshu.com"],
		bodyFormat: "rich-html",
		insertMode: "rich-html-placeholder-assets",
		pageScriptPositionsAssets: true,
		pageUploadDependencies: ["src/page-prosemirror-core.js"],
		pageUploadScript: "src/page-xiaohongshu-upload.js",
		pageUploadScriptVersion: "v2",
		pageUploadRequestSource: "OTP_COMPANION_XIAOHONGSHU_UPLOAD_REQUEST_V1",
		pageUploadResponseSource: "OTP_COMPANION_XIAOHONGSHU_UPLOAD_RESPONSE_V1",
		preferPaste: true,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: false,
		imageUploadWaitMs: 60000,
		markerWaitMs: 10000,
		filePasteDelayMs: 1200,
		autoInsertTimeoutMs: 90000,
		titleSelectors: [
			"input[placeholder*='标题']",
			"textarea[placeholder*='标题']",
			"input[placeholder*='Title']",
			"textarea[placeholder*='Title']",
			"[contenteditable='true'][data-placeholder*='标题']",
			"[contenteditable='true'][data-placeholder*='Title' i]"
		],
		bodySelectors: [
			".tiptap.ProseMirror[contenteditable='true']",
			".ProseMirror[contenteditable='true']"
		]
	});
})();
