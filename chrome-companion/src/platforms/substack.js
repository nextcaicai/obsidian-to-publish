(function () {
	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "substack",
		matchesHost: (host) => host === "substack.com" || host.endsWith(".substack.com"),
		bodyFormat: "rich-html",
		preferPaste: true,
		includeFilesInMainPaste: true,
		pasteFilesAfterText: false,
		titleSelectors: [
			"textarea[placeholder*='Title']",
			"input[placeholder*='Title']",
			"[contenteditable='true'][data-placeholder*='Title' i]",
			"[aria-label*='Title' i][contenteditable='true']"
		],
		bodySelectors: [
			".ProseMirror[contenteditable='true']",
			"[contenteditable='true'][data-testid*='editor' i]",
			"[contenteditable='true'][role='textbox']",
			"[contenteditable='true']"
		]
	});
})();
