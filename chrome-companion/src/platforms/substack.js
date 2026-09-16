(function () {
	const CREATE_LABELS = ["Create", "新建"];
	const ARTICLE_LABELS = ["Article", "文章"];

	function getSubstackPageMode(value) {
		try {
			const url = new URL(value);
			const path = url.pathname.replace(/\/+$/g, "");
			if (url.protocol !== "https:" || url.hostname === "substack.com" || !url.hostname.endsWith(".substack.com")) {
				return "invalid";
			}
			if (path === "/publish/home") {
				return "dashboard";
			}
			return /^\/publish\/post\/[^/]+$/i.test(path) ? "editor" : "invalid";
		} catch {
			return "invalid";
		}
	}

	function getEditorReadiness() {
		const pageMode = getSubstackPageMode(window.location.href);
		if (pageMode === "dashboard") {
			return { ready: false, terminal: false, reason: "substack_dashboard_pending" };
		}
		if (pageMode !== "editor") {
			return { ready: false, terminal: true, reason: "substack_not_personal_editor" };
		}
		const hasTitle = document.querySelector([
			"textarea[placeholder*='Title']",
			"input[placeholder*='Title']",
			"[contenteditable='true'][data-placeholder*='Title' i]",
			"[aria-label*='Title' i][contenteditable='true']"
		].join(","));
		const hasBody = document.querySelector([
			".ProseMirror[contenteditable='true']",
			"[contenteditable='true'][data-testid*='editor' i]",
			"[contenteditable='true'][role='textbox']"
		].join(","));
		return hasTitle && hasBody
			? { ready: true, terminal: false, reason: "" }
			: { ready: false, terminal: false, reason: "substack_editor_dom_not_ready" };
	}

	async function prepareEditor() {
		if (getSubstackPageMode(window.location.href) !== "dashboard") {
			return getEditorReadiness();
		}

		const createControl = findVisibleAction(CREATE_LABELS);
		if (!createControl) {
			return {
				ready: false,
				terminal: true,
				reason: "substack_editor_required: Create action was not found. Open Create → Article manually, then retry."
			};
		}
		activateAction(createControl);
		const articleControl = await waitForVisibleAction(ARTICLE_LABELS, 5000);
		if (!articleControl) {
			return {
				ready: false,
				terminal: true,
				reason: "substack_editor_required: Article action was not found. Open Create → Article manually, then retry."
			};
		}
		activateAction(articleControl);
		return { ready: false, terminal: false, reason: "substack_creating_article" };
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
		const semanticControls = document.querySelectorAll("button,[role='button'],[role='menuitem'],[data-radix-collection-item],a");
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
			if (labels.includes(text) || labels.includes(ariaLabel)) {
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

	globalThis.OTPCompanion.registerPlatformAdapter({
		id: "substack",
		matchesUrl: (value) => getSubstackPageMode(value) !== "invalid",
		getEditorReadiness,
		prepareEditor,
		getPageMode: getSubstackPageMode,
		createActionLabels: CREATE_LABELS,
		articleActionLabels: ARTICLE_LABELS,
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
