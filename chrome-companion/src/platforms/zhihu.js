(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "zhihu",
		hosts: ["www.zhihu.com", "zhuanlan.zhihu.com"],
		bodyFormat: "rich-html",
		insertMode: "rich-html-placeholder-assets",
		preferPaste: true,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: false,
		uploadImagesViaFileInput: true,
		uploadInputSelectors: [
			".PostEditor-wrapper input[type='file'][accept^='image/']:not(.UploadPicture-input)",
			".PostEditor input[type='file'][accept^='image/']:not(.UploadPicture-input)"
		],
		uploadInputExcludeClosestSelectors: [".UploadPicture-wrapper"],
		imageUploadWaitMs: 60000,
		markerWaitMs: 10000,
		markerPollMs: 300,
		markerCleanupSettleMs: 160,
		markerCleanupRetries: 2,
		markerSelectionSettleMs: 120,
		markerSelectionCommitWaitMs: 1200,
		markerSelectionPollMs: 40,
		markerSelectionStableMs: 80,
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
