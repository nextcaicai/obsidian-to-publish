(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "bilibili",
		hosts: ["member.bilibili.com"],
		frameScope: "child",
		bodyFormat: "rich-html",
		insertMode: "rich-html-placeholder-assets",
		pageScriptPositionsAssets: true,
		pageUploadDependencies: ["src/page-prosemirror-core.js"],
		pageUploadScript: "src/page-bilibili-upload.js",
		pageUploadScriptVersion: "v2",
		pageUploadRequestSource: "OTP_COMPANION_BILIBILI_UPLOAD_REQUEST_V1",
		pageUploadResponseSource: "OTP_COMPANION_BILIBILI_UPLOAD_RESPONSE_V1",
		preferPaste: true,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: false,
		imageUploadWaitMs: 60000,
		markerWaitMs: 10000,
		filePasteDelayMs: 1200,
		autoInsertTimeoutMs: 90000,
		titleSelectors: ["textarea.title-input__inner", "textarea[placeholder*='标题']"],
		bodySelectors: [
			".tiptap.ProseMirror[contenteditable='true']",
			".ProseMirror[contenteditable='true']"
		]
	});
})();
