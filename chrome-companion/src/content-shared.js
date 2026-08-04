(function () {
	const PANEL_ID = "obsidian-to-publish-companion-panel";
	const AUTO_INSERT_TIMEOUT_MS = 20000;
	const AUTO_INSERT_INTERVAL_MS = 700;
	const adapters = [];

	function registerPlatformAdapter(adapter) {
		adapters.push(adapter);
	}

	function getPlatformAdapter() {
		const host = window.location.hostname;
		return adapters.find((adapter) => {
			if (typeof adapter.matchesHost === "function") {
				return adapter.matchesHost(host);
			}
			return (adapter.hosts || []).includes(host);
		}) || null;
	}

	function insertDraftWithAdapter(task, adapter, options = {}) {
		const title = task.package?.article?.title || "";
		const payload = buildDraftPayload(task, adapter);
		const titleInserted = options.skipTitle ? false : tryInsertTitle(title, adapter);
		const bodyResult = tryInsertBody(payload, adapter);

		return {
			titleInserted,
			bodyInserted: bodyResult.inserted,
			imageIncluded: bodyResult.imageIncluded
		};
	}

	function tryInsertTitle(title, adapter) {
		if (!title.trim()) {
			return false;
		}

		const target = findTitleWritableElement(adapter);
		if (!target) {
			clickPotentialTitlePlaceholder(adapter);
			return false;
		}

		return insertIntoWritableElement(target, {
			text: title,
			html: "",
			files: []
		}, {
			allowHtml: false,
			preferPaste: false,
			replaceExisting: true
		}).inserted;
	}

	function tryInsertBody(payload, adapter) {
		if (!payload.text.trim() && !payload.html.trim() && payload.files.length === 0) {
			return {
				inserted: false,
				imageIncluded: false
			};
		}

		const target = getFocusedBodyElement(adapter) || findBodyWritableElement(adapter);
		if (!target) {
			return {
				inserted: false,
				imageIncluded: false
			};
		}

		const mainPayload = adapter.includeFilesInMainPaste === false
			? { ...payload, files: [] }
			: payload;
		const result = insertIntoWritableElement(target, mainPayload, {
			allowHtml: adapter.bodyFormat === "rich-html",
			preferPaste: adapter.preferPaste !== false,
			replaceExisting: false
		});

		if (result.inserted && adapter.pasteFilesAfterText && payload.files.length > 0) {
			const filePasteResult = dispatchPasteEvent(target, {
				text: "",
				html: "",
				files: payload.files
			});
			return {
				inserted: true,
				imageIncluded: filePasteResult.fileIncluded || result.imageIncluded
			};
		}

		return result;
	}

	function insertIntoWritableElement(target, payload, options) {
		target.focus();
		target.click();

		if (options.preferPaste) {
			const pasteResult = dispatchPasteEvent(target, payload);
			if (pasteResult.handled) {
				return {
					inserted: true,
					imageIncluded: pasteResult.fileIncluded || hasEmbeddedImages(payload)
				};
			}
		}

		if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
			if (!isVisibleWritableControl(target)) {
				return {
					inserted: false,
					imageIncluded: false
				};
			}

			insertIntoTextControl(target, payload.text, options.replaceExisting);
			return {
				inserted: true,
				imageIncluded: hasEmbeddedImages(payload)
			};
		}

		if (options.replaceExisting) {
			selectElementContents(target);
		}

		const html = options.allowHtml ? payload.html.trim() : "";
		const inserted = html
			? document.execCommand("insertHTML", false, html)
			: document.execCommand("insertText", false, payload.text);
		if (inserted) {
			dispatchInputEvent(target, payload.text);
			return {
				inserted: true,
				imageIncluded: hasEmbeddedImages(payload)
			};
		}

		if (!options.preferPaste) {
			const pasteResult = dispatchPasteEvent(target, payload);
			if (pasteResult.handled) {
				return {
					inserted: true,
					imageIncluded: pasteResult.fileIncluded || hasEmbeddedImages(payload)
				};
			}
		}

		return {
			inserted: false,
			imageIncluded: false
		};
	}

	function dispatchPasteEvent(target, payload) {
		try {
			const transfer = new DataTransfer();
			if (payload.html.trim()) {
				transfer.setData("text/html", payload.html);
			}
			if (payload.text.trim()) {
				transfer.setData("text/plain", payload.text);
			}
			for (const file of payload.files) {
				transfer.items.add(file);
			}

			const event = new ClipboardEvent("paste", {
				bubbles: true,
				cancelable: true,
				clipboardData: transfer
			});
			const wasNotCanceled = target.dispatchEvent(event);
			return {
				handled: !wasNotCanceled || event.defaultPrevented,
				fileIncluded: payload.files.length > 0
			};
		} catch (error) {
			console.warn("Unable to dispatch paste event.", error);
			return {
				handled: false,
				fileIncluded: false
			};
		}
	}

	function insertIntoTextControl(target, text, replaceExisting = false) {
		const start = replaceExisting ? 0 : target.selectionStart ?? target.value.length;
		const end = replaceExisting ? target.value.length : target.selectionEnd ?? target.value.length;
		setNativeValue(target, `${target.value.slice(0, start)}${text}${target.value.slice(end)}`);
		target.selectionStart = start + text.length;
		target.selectionEnd = start + text.length;
		dispatchInputEvent(target, text);
	}

	function setNativeValue(target, value) {
		const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value");
		if (descriptor?.set) {
			descriptor.set.call(target, value);
		} else {
			target.value = value;
		}
	}

	function selectElementContents(target) {
		const selection = window.getSelection();
		if (!selection) {
			return;
		}

		const range = document.createRange();
		range.selectNodeContents(target);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	function dispatchInputEvent(target, text) {
		target.dispatchEvent(new InputEvent("input", {
			bubbles: true,
			cancelable: true,
			inputType: "insertText",
			data: text
		}));
		target.dispatchEvent(new Event("change", {
			bubbles: true,
			cancelable: true
		}));
	}

	function buildDraftPayload(task, adapter) {
		const publishPackage = task.package || {};
		const article = publishPackage.article || {};
		const assetMap = buildAssetDataUriMap(publishPackage.assets || []);
		const files = buildAssetFiles(publishPackage.assets || []);
		const markdown = replaceAssetUrls(article.markdown || article.text || "", assetMap);
		const html = replaceAssetUrls(extractSafeHtmlFragment(article.html || ""), assetMap);

		if (adapter.bodyFormat !== "rich-html") {
			return {
				text: markdown,
				html: "",
				files
			};
		}

		return {
			text: article.text || markdown,
			html,
			files
		};
	}

	function extractSafeHtmlFragment(html) {
		if (!html.trim()) {
			return "";
		}

		const template = document.createElement("template");
		template.innerHTML = html;
		for (const element of Array.from(template.content.querySelectorAll("script,style,iframe,object,embed"))) {
			element.remove();
		}

		const sourceSection = template.content.querySelector("section[data-source='obsidian-to-publish']");
		return (sourceSection?.innerHTML || template.innerHTML).trim();
	}

	function buildAssetDataUriMap(assets) {
		const map = new Map();
		for (const asset of assets) {
			if (!asset || asset.kind !== "image" || !asset.id || !asset.mime || !asset.base64) {
				continue;
			}
			map.set(asset.id, `data:${asset.mime};base64,${asset.base64}`);
		}
		return map;
	}

	function buildAssetFiles(assets) {
		const files = [];
		for (const asset of assets) {
			const file = assetToFile(asset);
			if (file) {
				files.push(file);
			}
		}
		return files;
	}

	function assetToFile(asset) {
		if (!asset || asset.kind !== "image" || !asset.base64 || !asset.mime) {
			return null;
		}

		try {
			const binary = atob(asset.base64);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) {
				bytes[index] = binary.charCodeAt(index);
			}
			return new File([bytes], asset.fileName || `${asset.id}.png`, {
				type: asset.mime
			});
		} catch (error) {
			console.warn("Unable to decode publish asset.", error);
			return null;
		}
	}

	function replaceAssetUrls(value, assetMap) {
		if (!value || assetMap.size === 0) {
			return value || "";
		}

		return value.replace(/asset:\/\/([a-zA-Z0-9_-]+)/g, (match, assetId) => {
			return assetMap.get(assetId) || match;
		});
	}

	function hasEmbeddedImages(payload) {
		return payload.files.length > 0 || /<img\b|data:image\//i.test(`${payload.html}\n${payload.text}`);
	}

	function getFocusedBodyElement(adapter) {
		const active = document.activeElement;
		if (isWritableElement(active) && !isLikelyTitleElement(active) && !active.closest(`#${PANEL_ID}`)) {
			return active;
		}

		return findWritableElementBySelectors(adapter.bodySelectors);
	}

	function findBodyWritableElement(adapter) {
		return findWritableElementBySelectors(adapter.bodySelectors) || findLargestBodyElement();
	}

	function findTitleWritableElement(adapter) {
		return findWritableElementBySelectors(adapter.titleSelectors)
			|| getWritableCandidates().find(({ element }) => isLikelyTitleElement(element))?.element
			|| null;
	}

	function findWritableElementBySelectors(selectors = []) {
		for (const selector of selectors) {
			for (const element of Array.from(document.querySelectorAll(selector))) {
				const writable = resolveWritableElement(element);
				if (writable && isVisibleWritableElement(writable)) {
					return writable;
				}
			}
		}

		return null;
	}

	function resolveWritableElement(element) {
		if (isWritableElement(element)) {
			return element;
		}

		return element.querySelector?.("textarea,input,[contenteditable='true'],[role='textbox']") || null;
	}

	function findLargestBodyElement() {
		return getWritableCandidates()
			.filter(({ element, rect }) => !isLikelyTitleElement(element) && rect.width > 120 && rect.height > 40)
			.sort((left, right) => (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height))[0]?.element
			|| null;
	}

	function getWritableCandidates() {
		return Array.from(document.querySelectorAll("textarea,input,[contenteditable='true'],[role='textbox']"))
			.filter((element) => isWritableElement(element) && isVisibleWritableElement(element))
			.map((element) => ({
				element,
				rect: element.getBoundingClientRect()
			}))
			.sort((left, right) => left.rect.top - right.rect.top);
	}

	function isWritableElement(element) {
		if (!(element instanceof HTMLElement)) {
			return false;
		}

		if (element.closest(`#${PANEL_ID}`)) {
			return false;
		}

		if (element instanceof HTMLTextAreaElement) {
			return !element.disabled && !element.readOnly;
		}

		if (element instanceof HTMLInputElement) {
			return !element.disabled && !element.readOnly && ["", "text", "search", "url"].includes(element.type);
		}

		return element.isContentEditable || element.getAttribute("role") === "textbox";
	}

	function isVisibleWritableElement(element) {
		if (!element.isConnected) {
			return false;
		}

		const rect = element.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) {
			return false;
		}

		const style = window.getComputedStyle(element);
		return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
	}

	function isVisibleWritableControl(element) {
		if (!isVisibleWritableElement(element)) {
			return false;
		}

		const rect = element.getBoundingClientRect();
		return rect.width > 20 && rect.height > 16;
	}

	function isLikelyTitleElement(element) {
		const text = [
			element.getAttribute("placeholder"),
			element.getAttribute("aria-label"),
			element.getAttribute("data-placeholder"),
			element.getAttribute("name"),
			element.getAttribute("id"),
			element.className
		].join(" ");

		return /title|headline|subject|标题|题目/i.test(text);
	}

	function clickPotentialTitlePlaceholder(adapter) {
		for (const label of adapter.titleClickText || []) {
			const element = Array.from(document.querySelectorAll("h1,h2,header div,header span,div,span"))
				.find((candidate) => candidate.textContent?.trim() === label);
			if (element instanceof HTMLElement) {
				element.click();
				return true;
			}
		}

		return false;
	}

	function delay(ms) {
		return new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	globalThis.OTPCompanion = {
		AUTO_INSERT_INTERVAL_MS,
		AUTO_INSERT_TIMEOUT_MS,
		PANEL_ID,
		delay,
		getPlatformAdapter,
		insertDraftWithAdapter,
		registerPlatformAdapter
	};
})();
