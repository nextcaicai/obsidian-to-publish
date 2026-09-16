(function () {
	const CREATE_ARTICLE_LABELS = ["Write", "撰写"];

	function isArticlesDraftsPage(value) {
		try {
			const url = new URL(value);
			return (url.hostname === "x.com" || url.hostname === "twitter.com")
				&& url.pathname.replace(/\/+$/g, "") === "/compose/articles";
		} catch {
			return false;
		}
	}

	function getEditorReadiness() {
		if (isArticlesDraftsPage(window.location.href)) {
			return { ready: false, terminal: false, reason: "x_drafts_pending" };
		}

		const hasTitle = document.querySelector([
			"input[placeholder*='title' i]",
			"textarea[placeholder*='title' i]",
			"input[placeholder*='标题']",
			"textarea[placeholder*='标题']",
			"[data-testid*='title' i][contenteditable='true']",
			"[aria-label*='title' i][contenteditable='true']",
			"[aria-label*='标题'][contenteditable='true']",
			"[contenteditable='true'][data-placeholder*='title' i]"
		].join(","));
		const hasBody = document.querySelector([
			"[data-testid*='article' i] [contenteditable='true']",
			".public-DraftEditor-content[contenteditable='true']",
			"[contenteditable='true'][role='textbox']",
			"[role='textbox'][contenteditable='true']"
		].join(","));
		return hasTitle && hasBody
			? { ready: true, terminal: false, reason: "" }
			: { ready: false, terminal: false, reason: "x_editor_dom_not_ready" };
	}

	async function prepareEditor() {
		if (!isArticlesDraftsPage(window.location.href)) {
			return getEditorReadiness();
		}

		const createControl = await waitForVisibleAction(CREATE_ARTICLE_LABELS, 8000);
		if (!createControl) {
			return {
				ready: false,
				terminal: true,
				reason: "x_editor_required: Write action was not found. Open the article editor manually, then retry."
			};
		}
		activateAction(createControl);
		return { ready: false, terminal: false, reason: "x_creating_article" };
	}

	function activateAction(control) {
		control.scrollIntoView?.({ block: "center", inline: "center" });
		control.focus?.({ preventScroll: true });
		const pointerDown = {
			bubbles: true,
			cancelable: true,
			composed: true,
			button: 0,
			buttons: 1,
			pointerId: 1,
			pointerType: "mouse",
			isPrimary: true
		};
		const pointerUp = { ...pointerDown, buttons: 0 };
		const mouseDown = {
			bubbles: true,
			cancelable: true,
			composed: true,
			button: 0,
			buttons: 1,
			view: window
		};
		const mouseUp = { ...mouseDown, buttons: 0 };

		control.dispatchEvent(new PointerEvent("pointerdown", pointerDown));
		control.dispatchEvent(new MouseEvent("mousedown", mouseDown));
		control.dispatchEvent(new PointerEvent("pointerup", pointerUp));
		control.dispatchEvent(new MouseEvent("mouseup", mouseUp));
		control.dispatchEvent(new MouseEvent("click", mouseUp));
	}

	function findVisibleAction(labels) {
		const semanticControls = document.querySelectorAll("button,[role='button'],a");
		return findExactVisibleAction(semanticControls, labels)
			|| findExactVisibleAction(document.querySelectorAll("body *"), labels);
	}

	function findExactVisibleAction(controls, labels) {
		for (const control of controls) {
			if (
				!(control instanceof HTMLElement)
				|| control.hidden
				|| control.getAttribute("aria-hidden") === "true"
				|| control.hasAttribute("disabled")
				|| control.getAttribute("aria-disabled") === "true"
			) {
				continue;
			}
			const style = typeof window.getComputedStyle === "function"
				? window.getComputedStyle(control)
				: null;
			if (style?.display === "none" || style?.visibility === "hidden") {
				continue;
			}
			if (typeof control.getClientRects === "function" && control.getClientRects().length === 0) {
				continue;
			}
			const text = normalizeActionLabel(control.textContent);
			const ariaLabel = normalizeActionLabel(control.getAttribute("aria-label"));
			if (labels.some((label) => matchesActionLabel(text, label) || matchesActionLabel(ariaLabel, label))) {
				return control;
			}
		}
		return null;
	}

	function normalizeActionLabel(value) {
		return (value || "").replace(/\s+/g, " ").trim();
	}

	async function waitForVisibleAction(labels, timeoutMs) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			const action = findVisibleAction(labels);
			if (action) {
				return action;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return null;
	}

	function matchesActionLabel(value, label) {
		return value === label || value.startsWith(`${label} `);
	}

	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "x",
		hosts: ["x.com", "twitter.com"],
		getEditorReadiness,
		prepareEditor,
		createArticleLabels: CREATE_ARTICLE_LABELS,
		bodyFormat: "markdown",
		insertMode: "markdown-page-upload-markers",
		pageScriptWritesBody: true,
		pageUploadDependencies: ["src/page-editor-order.js", "src/page-x-markdown.js"],
		preferPaste: false,
		includeFilesInMainPaste: false,
		pasteFilesAfterText: false,
		replaceAssetUrlsInMarkdown: false,
		pageUploadScript: "src/page-x-upload.js",
		// The X editor is an SPA. A Companion reload can leave an older main-world
		// page script alive in the same document, so version both its DOM id and its
		// request channel. Otherwise the stale script can answer a new write request
		// first and make the freshly opened editor look unwritable.
		pageUploadScriptVersion: "v6",
		pageUploadRequestSource: "OTP_COMPANION_X_UPLOAD_REQUEST_V2",
		pageUploadResponseSource: "OTP_COMPANION_X_UPLOAD_RESPONSE_V2",
		autoInsertTimeoutMs: 60000,
		imageUploadWaitMs: 90000,
		titleSelectors: [
			"input[placeholder*='title' i]",
			"textarea[placeholder*='title' i]",
			"input[placeholder*='标题']",
			"textarea[placeholder*='标题']",
			"[data-testid*='title' i][contenteditable='true']",
			"[aria-label*='title' i][contenteditable='true']",
			"[aria-label*='标题'][contenteditable='true']",
			"[contenteditable='true'][data-placeholder*='title' i]"
		],
		bodySelectors: [
			"[data-testid*='article' i] [contenteditable='true']",
			".public-DraftEditor-content[contenteditable='true']",
			"[contenteditable='true'][role='textbox']",
			"[role='textbox'][contenteditable='true']"
		]
	});
})();
