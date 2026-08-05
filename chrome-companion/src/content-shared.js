(function () {
	const PANEL_ID = "obsidian-to-publish-companion-panel";
	const AUTO_INSERT_TIMEOUT_MS = 20000;
	const AUTO_INSERT_INTERVAL_MS = 700;
	const adapters = [];
	const uploadCachesByPlatform = new Map();

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

	async function insertDraftWithAdapter(task, adapter, options = {}) {
		const title = task.package?.article?.title || "";
		const payload = buildDraftPayload(task, adapter);
		const titleInserted = options.skipTitle ? false : tryInsertTitle(title, adapter);
		const bodyResult = await tryInsertBody(payload, adapter);

		return {
			titleInserted,
			bodyInserted: bodyResult.inserted,
			imageIncluded: bodyResult.imageIncluded,
			imageTotal: bodyResult.imageTotal || 0,
			imageUploaded: bodyResult.imageUploaded || 0,
			imageFailed: bodyResult.imageFailed || 0
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

	async function tryInsertBody(payload, adapter) {
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

		if (adapter.insertMode === "markdown-sequential-assets") {
			return insertMarkdownSequentialAssets(target, payload, adapter);
		}

		if (adapter.insertMode === "markdown-placeholder-assets") {
			return insertMarkdownWithImageMarkers(target, payload, adapter);
		}

		if (adapter.insertMode === "markdown-page-upload-assets") {
			return insertMarkdownWithPageUploadedAssets(target, payload, adapter);
		}

		if (adapter.insertMode === "markdown-page-upload-markers") {
			return insertMarkdownWithPageUploadedMarkers(target, payload, adapter);
		}

		const fileCount = payload.files.length;
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
			const filePasteHandled = filePasteResult.handled && filePasteResult.fileIncluded;
			return {
				inserted: true,
				imageDelivery: "paste",
				imageIncluded: filePasteHandled || result.imageIncluded,
				imageTotal: fileCount,
				imageUploaded: filePasteHandled ? fileCount : 0,
				imageFailed: filePasteHandled ? 0 : fileCount
			};
		}

		return result;
	}

	async function insertMarkdownSequentialAssets(target, payload, adapter) {
		const segments = splitMarkdownAssetSegments(payload.text, payload.assetFilesById);
		let insertedText = false;
		let imageIncluded = false;

		for (const segment of segments) {
			if (segment.type === "text") {
				if (!segment.value) {
					continue;
				}

				const result = insertIntoWritableElement(target, {
					text: segment.value,
					html: "",
					files: []
				}, {
					allowHtml: false,
					preferPaste: adapter.preferPaste !== false,
					replaceExisting: false
				});
				insertedText = insertedText || result.inserted;
				if (!result.inserted) {
					return {
						inserted: insertedText,
						imageIncluded
					};
				}
				continue;
			}

			const filePasteResult = dispatchPasteEvent(target, {
				text: "",
				html: "",
				files: [segment.file]
			});
			imageIncluded = imageIncluded || (filePasteResult.handled && filePasteResult.fileIncluded);
			await delay(adapter.filePasteDelayMs ?? 1200);
		}

		return {
			inserted: insertedText || imageIncluded,
			imageIncluded
		};
	}

	async function insertMarkdownWithPageUploadedAssets(target, payload, adapter) {
		const assetTools = globalThis.OTPCompanionAssets;
		if (!assetTools?.uploadMarkdownAssets) {
			return {
				inserted: false,
				imageIncluded: false
			};
		}

		const uploadResult = await assetTools.uploadMarkdownAssets({
			markdown: payload.text,
			assets: payload.assets,
			uploadAsset: (asset) => uploadAssetThroughAdapter(target, asset, adapter),
			cache: getUploadCache(adapter),
			concurrency: adapter.uploadQueueConcurrency ?? 2,
			retries: adapter.uploadQueueRetries ?? 2,
			retryDelayMs: adapter.uploadQueueRetryDelayMs ?? 1000
		});

		if (uploadResult.images.length === 0) {
			return insertIntoWritableElement(target, {
				text: payload.text,
				html: "",
				files: []
			}, {
				allowHtml: false,
				preferPaste: adapter.preferPaste !== false,
				replaceExisting: false
			});
		}

		const result = insertIntoWritableElement(target, {
			text: uploadResult.markdown,
			html: "",
			files: []
		}, {
			allowHtml: false,
			preferPaste: adapter.preferPaste !== false,
			replaceExisting: false
		});

		return {
			inserted: result.inserted,
			imageIncluded: uploadResult.urlByAssetId.size > 0,
			imageTotal: uploadResult.images.length,
			imageUploaded: uploadResult.urlByAssetId.size,
			imageFailed: uploadResult.uploads.filter((upload) => !upload.url).length
		};
	}

	async function insertMarkdownWithPageUploadedMarkers(target, payload, adapter) {
		const markerPlan = buildMarkdownAssetMarkerPlan(payload.text, payload.assets);
		const textResult = insertIntoWritableElement(target, {
			text: markerPlan.markdown,
			html: "",
			files: []
		}, {
			allowHtml: false,
			preferPaste: adapter.preferPaste !== false,
			replaceExisting: false
		});
		if (!textResult.inserted) {
			return {
				inserted: false,
				imageIncluded: false
			};
		}

		if (markerPlan.images.length === 0) {
			return {
				inserted: true,
				imageIncluded: false
			};
		}

		let uploaded = 0;
		let failed = 0;
		for (const image of markerPlan.images) {
			const upload = await uploadAssetToMarkerViaPageScript(image.asset, image.marker, adapter);
			if (upload?.ok || upload?.url || upload?.placed) {
				uploaded += 1;
			} else {
				failed += 1;
			}
		}

		return {
			inserted: true,
			imageDelivery: "page-marker-upload",
			imageIncluded: uploaded > 0,
			imageTotal: markerPlan.images.length,
			imageUploaded: uploaded,
			imageFailed: failed
		};
	}

	async function uploadAssetThroughAdapter(target, asset, adapter) {
		const pageUpload = await uploadAssetViaPageScript(asset, adapter);
		if (pageUpload?.url || !adapter.fallbackUploadViaPaste) {
			return pageUpload;
		}

		const pasteUpload = await uploadAssetViaEditorPaste(target, asset, adapter);
		return pasteUpload || pageUpload;
	}

	async function insertMarkdownWithImageMarkers(target, payload, adapter) {
		const markerPlan = buildMarkdownImageMarkerPlan(payload.text, payload.assetFilesById);
		const textResult = insertIntoWritableElement(target, {
			text: markerPlan.markdown,
			html: "",
			files: []
		}, {
			allowHtml: false,
			preferPaste: adapter.preferPaste !== false,
			replaceExisting: false
		});
		if (!textResult.inserted) {
			return {
				inserted: false,
				imageIncluded: false
			};
		}

		let imageIncluded = false;
		for (const item of markerPlan.images) {
			const markerFound = await waitForCondition(
				() => selectMarkerText(target, item.marker),
				adapter.markerWaitMs ?? 5000,
				adapter.markerPollMs ?? 250
			);
			if (!markerFound) {
				continue;
			}

			const beforeUploadText = getUploadSearchText(target, adapter);
			if (adapter.uploadImagesViaFileInput) {
				const inputUploadStarted = await uploadImageViaFileInput(item.file, adapter);
				const inputUploadedImageMarkdown = inputUploadStarted
					? await waitForValue(
						() => findNewUploadedImageMarkdown(beforeUploadText, getUploadSearchText(target, adapter), adapter, item),
						adapter.imageUploadWaitMs ?? 12000,
						adapter.markerPollMs ?? 250
					)
					: null;
				if (inputUploadedImageMarkdown) {
					const relocated = relocateUploadedImageMarkdown(target, item.marker, inputUploadedImageMarkdown.snippet);
					if (relocated) {
						imageIncluded = true;
						continue;
					}
				}
			}

			const pasteResult = dispatchPasteEvent(target, {
				text: "",
				html: "",
				files: [item.file]
			});
			const relocatedImageMarkdown = adapter.relocateUploadedImageMarkdown
				? await waitForValue(
					() => findNewUploadedImageMarkdown(beforeUploadText, getUploadSearchText(target, adapter), adapter, item),
					adapter.imageUploadWaitMs ?? 12000,
					adapter.markerPollMs ?? 250
				)
				: null;
			if (relocatedImageMarkdown) {
				const relocated = relocateUploadedImageMarkdown(target, item.marker, relocatedImageMarkdown.snippet);
				if (relocated) {
					imageIncluded = true;
					continue;
				}
			}

			const uploadOutcome = (pasteResult.handled || adapter.cleanupUploadedMarkerAltText) ? await waitForValue(
				() => findMarkerUploadOutcome(getWritableText(target), item, adapter),
				adapter.imageUploadWaitMs ?? 12000,
				adapter.markerPollMs ?? 250
			) : null;
			if (uploadOutcome?.type === "wrapped") {
				const replacement = `![${getSafeImageAlt(item.file)}](${uploadOutcome.url})`;
				const cleaned = replaceTextInWritable(target, uploadOutcome.snippet, replacement);
				if (cleaned) {
					imageIncluded = true;
					continue;
				}
			}

			const uploadInserted = uploadOutcome?.type === "removed";
			imageIncluded = imageIncluded || uploadInserted;
			if (!uploadInserted) {
				removeMarkerText(target, item.marker);
			}
		}

		return {
			inserted: true,
			imageIncluded
		};
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

	function getCodeMirrorView(target) {
		const content = target?.classList?.contains("cm-content")
			? target
			: target?.closest?.(".cm-editor")?.querySelector(".cm-content")
				|| target?.querySelector?.(".cm-content");
		const view = content?.cmView?.view || content?.cmView?.rootView?.view;
		return view?.state?.doc && typeof view.dispatch === "function" ? view : null;
	}

	function replaceTextInWritable(target, search, replacement) {
		const view = getCodeMirrorView(target);
		if (view) {
			const text = view.state.doc.toString();
			const index = text.indexOf(search);
			if (index < 0) {
				return false;
			}

			view.dispatch({
				changes: {
					from: index,
					to: index + search.length,
					insert: replacement
				},
				selection: {
					anchor: index + replacement.length
				},
				scrollIntoView: true
			});
			view.focus();
			dispatchInputEvent(target, replacement);
			return true;
		}

		if (!selectMarkerText(target, search)) {
			return false;
		}

		if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
			insertIntoTextControl(target, replacement, false);
			return true;
		}

		const inserted = document.execCommand("insertText", false, replacement);
		if (inserted) {
			dispatchInputEvent(target, replacement);
		}
		return inserted;
	}

	function removeTextFromWritable(target, text) {
		return replaceTextInWritable(target, text, "");
	}

	function relocateUploadedImageMarkdown(target, marker, snippet) {
		const text = getWritableText(target);
		if (!text.includes(marker)) {
			return text.includes(snippet);
		}

		if (text.includes(snippet)) {
			removeTextFromWritable(target, snippet);
		}
		return replaceTextInWritable(target, marker, snippet);
	}

	function getUploadSearchText(target, adapter) {
		const parts = [getWritableText(target)];
		if (adapter.uploadSearchRootSelector) {
			const root = target.closest?.(adapter.uploadSearchRootSelector) || document.querySelector(adapter.uploadSearchRootSelector);
			if (root?.textContent) {
				parts.push(root.textContent);
			}
		}
		if (adapter.searchDocumentTextForUploads) {
			parts.push(document.body.innerText || "");
		}
		return parts.join("\n");
	}

	function findNewUploadedImageMarkdown(beforeText, afterText, adapter, item) {
		const before = String(beforeText || "");
		const after = String(afterText || "");
		const markdownImages = extractMarkdownImageReferences(after)
			.filter((candidate) => !before.includes(candidate.snippet))
			.filter((candidate) => isUploadedImageMatch(candidate.url, adapter));
		if (markdownImages.length > 0) {
			return markdownImages[markdownImages.length - 1];
		}

		const urls = extractImageUrls(after)
			.filter((url) => !before.includes(url))
			.filter((url) => isUploadedImageMatch(url, adapter));
		const url = urls[urls.length - 1];
		if (!url) {
			return null;
		}

		return {
			snippet: `![${getSafeImageAlt(item.file)}](${url})`,
			url
		};
	}

	function findMarkerUploadOutcome(text, item, adapter) {
		if (!text.includes(item.marker)) {
			return {
				type: "removed"
			};
		}

		if (!adapter.cleanupUploadedMarkerAltText) {
			return null;
		}

		const wrapped = findMarkerWrappedImageMarkdown(text, item.marker, adapter);
		return wrapped ? {
			type: "wrapped",
			...wrapped
		} : null;
	}

	function findMarkerWrappedImageMarkdown(text, marker, adapter) {
		const markerIndex = text.indexOf(marker);
		if (markerIndex < 0) {
			return null;
		}

		const start = text.lastIndexOf("![", markerIndex);
		const urlStart = text.indexOf("](", markerIndex + marker.length);
		if (start < 0 || urlStart < 0) {
			return null;
		}

		const close = text.indexOf(")", urlStart + 2);
		if (close < 0) {
			return null;
		}

		const url = text.slice(urlStart + 2, close).trim();
		if (!/^https?:\/\//i.test(url) || !isUploadedImageMatch(url, adapter)) {
			return null;
		}

		return {
			snippet: text.slice(start, close + 1),
			url
		};
	}

	function extractMarkdownImageReferences(text) {
		const matches = [];
		const pattern = /!\[([^\]\n]*)]\((https?:\/\/[^\s)]+)\)/g;
		let match;
		while ((match = pattern.exec(text)) !== null) {
			matches.push({
				snippet: match[0],
				url: match[2]
			});
		}
		return matches;
	}

	function extractImageUrls(text) {
		const matches = [];
		const pattern = /https?:\/\/[^\s)]+(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/gi;
		let match;
		while ((match = pattern.exec(text)) !== null) {
			matches.push(match[0]);
		}
		return matches;
	}

	function isUploadedImageMatch(url, adapter) {
		const pattern = adapter.uploadedImageUrlPattern;
		if (!pattern) {
			return true;
		}
		if (pattern instanceof RegExp) {
			pattern.lastIndex = 0;
			return pattern.test(url);
		}
		return new RegExp(String(pattern), "i").test(url);
	}

	function getSafeImageAlt(file) {
		const name = file?.name || "image";
		return name.replace(/\.[^.]+$/, "").replace(/[\]\n\r]/g, " ").trim() || "image";
	}

	function sanitizeImageAlt(value) {
		return String(value || "image").replace(/[\]\n\r]/g, " ").trim() || "image";
	}

	async function uploadImageViaFileInput(file, adapter) {
		const input = await findImageUploadInput(adapter);
		if (!input) {
			return false;
		}

		try {
			const transfer = new DataTransfer();
			transfer.items.add(file);
			input.files = transfer.files;
			input.dispatchEvent(new Event("input", {
				bubbles: true,
				cancelable: true
			}));
			input.dispatchEvent(new Event("change", {
				bubbles: true,
				cancelable: true
			}));
			return true;
		} catch (error) {
			console.warn("Unable to upload image through file input.", error);
			return false;
		}
	}

	async function findImageUploadInput(adapter) {
		const existingInputs = new Set(findImageUploadInputs(adapter));
		const uploadButton = findUploadButton(adapter);
		if (adapter.clickUploadButtonBeforeInput && uploadButton) {
			uploadButton.click();
			await delay(adapter.uploadInputCreateDelayMs ?? 500);
			const createdInput = findImageUploadInputs(adapter, existingInputs)[0] || null;
			if (createdInput) {
				return createdInput;
			}
		}

		const existingInput = findImageUploadInputs(adapter)[0] || null;
		if (existingInput) {
			return existingInput;
		}

		if (!adapter.clickUploadButtonBeforeInput && uploadButton) {
			uploadButton.click();
			await delay(adapter.uploadInputCreateDelayMs ?? 500);
		}

		return findImageUploadInputs(adapter, existingInputs)[0] || null;
	}

	function findImageUploadInputs(adapter, excludedInputs = new Set()) {
		const selectors = adapter.uploadInputSelectors?.length
			? adapter.uploadInputSelectors
			: ["input[type='file']"];
		const inputs = [];
		for (const selector of selectors) {
			for (const input of Array.from(document.querySelectorAll(selector))) {
				if (excludedInputs.has(input) || !isImageUploadInput(input, adapter) || inputs.includes(input)) {
					continue;
				}
				inputs.push(input);
			}
		}
		return inputs;
	}

	function isImageUploadInput(input, adapter) {
		if (!(input instanceof HTMLInputElement) || input.type !== "file" || input.disabled) {
			return false;
		}
		for (const selector of adapter.uploadInputExcludeClosestSelectors || []) {
			if (input.closest(selector)) {
				return false;
			}
		}

		const accept = input.accept || "";
		return !accept.trim() || /image|\.(png|jpe?g|gif|webp)/i.test(accept);
	}

	function findUploadButton(adapter) {
		for (const selector of adapter.uploadButtonSelectors || []) {
			const element = document.querySelector(selector);
			if (element instanceof HTMLElement && isVisibleElement(element)) {
				return element;
			}
		}

		for (const label of adapter.uploadButtonText || []) {
			const element = Array.from(document.querySelectorAll("button,[role='button'],span,div"))
				.find((candidate) => candidate instanceof HTMLElement
					&& isVisibleElement(candidate)
					&& candidate.textContent?.trim() === label);
			if (element instanceof HTMLElement) {
				return element;
			}
		}

		return null;
	}

	async function uploadImagesViaPageScript(files, adapter) {
		if (!adapter.pageUploadScript) {
			return [];
		}

		await injectPageScript(adapter.pageUploadScript, adapter.pageUploadScriptVersion);
		const batchSize = Math.max(1, adapter.pageUploadBatchSize ?? files.length);
		const uploads = [];
		for (let index = 0; index < files.length; index += batchSize) {
			const batch = files.slice(index, index + batchSize);
			const batchUploads = await uploadImageBatchViaPageScript(batch, adapter);
			uploads.push(...batchUploads);
		}
		return uploads;
	}

	async function uploadImageBatchViaPageScript(files, adapter) {
		const assets = await Promise.all(files.map(fileToBase64Asset));
		return uploadPageAssetsViaPageScript(assets, adapter, files.length);
	}

	async function uploadAssetViaPageScript(asset, adapter) {
		if (!adapter.pageUploadScript || !asset?.base64) {
			return null;
		}

		await injectPageScript(adapter.pageUploadScript, adapter.pageUploadScriptVersion);
		const uploads = await uploadPageAssetsViaPageScript([{
			name: asset.fileName || `${asset.id}.png`,
			type: asset.mime || "image/png",
			base64: asset.base64
		}], adapter, 1);
		return uploads[0] || null;
	}

	async function uploadAssetToMarkerViaPageScript(asset, marker, adapter) {
		if (!adapter.pageUploadScript || !asset?.base64 || !marker) {
			return null;
		}

		await injectPageScript(adapter.pageUploadScript, adapter.pageUploadScriptVersion);
		const uploads = await uploadPageAssetsViaPageScript([{
			name: asset.fileName || `${asset.id}.png`,
			type: asset.mime || "image/png",
			base64: asset.base64,
			marker,
			assetId: asset.id || "",
			alt: asset.fileName || ""
		}], adapter, 1);
		return uploads[0] || null;
	}

	async function uploadAssetViaEditorPaste(target, asset, adapter) {
		const file = assetToFile(asset);
		if (!file) {
			return null;
		}

		const beforeUploadText = getUploadSearchText(target, adapter);
		target.focus();
		target.click();
		const pasteResult = dispatchPasteEvent(target, {
			text: "",
			html: "",
			files: [file]
		});
		if (!pasteResult.fileIncluded) {
			return null;
		}

		const uploadedImageMarkdown = await waitForValue(
			() => findNewUploadedImageMarkdown(beforeUploadText, getUploadSearchText(target, adapter), adapter, { file }),
			adapter.imageUploadWaitMs ?? 12000,
			adapter.markerPollMs ?? 250
		);
		if (!uploadedImageMarkdown?.url) {
			return null;
		}

		const removedTemporarySnippet = removeTextFromWritable(target, uploadedImageMarkdown.snippet);
		if (!removedTemporarySnippet) {
			removeTextFromWritable(target, uploadedImageMarkdown.url);
		}
		return {
			url: uploadedImageMarkdown.url
		};
	}

	function uploadPageAssetsViaPageScript(assets, adapter, expectedCount) {
		const requestId = `otp-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		return new Promise((resolve) => {
			const timeout = window.setTimeout(() => {
				window.removeEventListener("message", onMessage);
				resolve(new Array(expectedCount).fill(null));
			}, adapter.pageUploadWaitMs ?? Math.max(adapter.imageUploadWaitMs ?? 12000, expectedCount * 15000));

			function onMessage(event) {
				if (event.source !== window
					|| event.data?.source !== adapter.pageUploadResponseSource
					|| event.data.requestId !== requestId) {
					return;
				}

				window.clearTimeout(timeout);
				window.removeEventListener("message", onMessage);
				if (!event.data.ok) {
					console.warn(`${adapter.id || "platform"} page upload failed.`, event.data.error);
					resolve(new Array(expectedCount).fill(null));
					return;
				}

				const uploads = event.data.uploads || [];
				for (const upload of uploads) {
					if (upload?.error) {
						console.warn(`${adapter.id || "platform"} image upload failed.`, upload.error);
					}
				}
				resolve(new Array(expectedCount).fill(null).map((_, index) => uploads[index] || null));
			}

			window.addEventListener("message", onMessage);
			window.postMessage({
				source: adapter.pageUploadRequestSource,
				requestId,
				assets,
				options: {
					...(adapter.pageUploadOptions || {}),
					concurrency: adapter.pageUploadConcurrency ?? 2,
					retries: adapter.pageUploadRetries ?? 2
				}
			}, window.location.origin);
		});
	}

	function getUploadCache(adapter) {
		const key = adapter.id || "default";
		if (!uploadCachesByPlatform.has(key)) {
			uploadCachesByPlatform.set(key, new Map());
		}
		return uploadCachesByPlatform.get(key);
	}

	function injectPageScript(scriptPath, version = "v1") {
		const scriptId = `otp-companion-page-script:${scriptPath}:${version}`;
		const existingScript = document.getElementById(scriptId);
		if (existingScript?.dataset.loaded === "true") {
			return Promise.resolve(true);
		}

		return new Promise((resolve) => {
			const script = existingScript || document.createElement("script");
			const finish = () => {
				script.dataset.loaded = "true";
				resolve(true);
			};

			script.addEventListener("load", finish, {
				once: true
			});
			script.addEventListener("error", () => {
				console.warn("Unable to load page script.", scriptPath);
				resolve(false);
			}, {
				once: true
			});

			if (!existingScript) {
				script.id = scriptId;
				script.src = chrome.runtime.getURL(scriptPath);
				script.async = false;
				(document.head || document.documentElement).appendChild(script);
			}
		});
	}

	function fileToBase64Asset(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const value = String(reader.result || "");
				resolve({
					name: file.name,
					type: file.type,
					base64: value.includes(",") ? value.split(",").pop() : value
				});
			};
			reader.onerror = () => reject(reader.error || new Error("Unable to read image file."));
			reader.readAsDataURL(file);
		});
	}

	function buildDraftPayload(task, adapter) {
		const publishPackage = task.package || {};
		const article = publishPackage.article || {};
		const assets = Array.isArray(publishPackage.assets) ? publishPackage.assets : [];
		const assetMap = buildAssetDataUriMap(publishPackage.assets || []);
		const files = adapter.omitAssets ? [] : buildAssetFiles(publishPackage.assets || []);
		const assetFilesById = buildAssetFileMap(publishPackage.assets || []);
		const stripAssetReferences = adapter.stripAssetReferences === true;
		const sourceMarkdown = adapter.omitAssets || stripAssetReferences
			? removeUnportableMarkdownImages(article.markdown || article.text || "")
			: article.markdown || article.text || "";
		const markdown = adapter.replaceAssetUrlsInMarkdown === false
			? sourceMarkdown
			: replaceAssetUrls(sourceMarkdown, assetMap);
		const sourceHtml = adapter.omitAssets || stripAssetReferences
			? removeImagesFromHtml(extractSafeHtmlFragment(article.html || ""))
			: extractSafeHtmlFragment(article.html || "");
		const html = replaceAssetUrls(sourceHtml, assetMap);
		const text = adapter.omitAssets || stripAssetReferences
			? removeUnportableMarkdownImages(article.text || sourceMarkdown)
			: article.text || markdown;

		if (adapter.bodyFormat === "plain-text") {
			return {
				text,
				html: "",
				files,
				assetFilesById,
				assets
			};
		}

		if (adapter.bodyFormat !== "rich-html") {
			return {
				text: markdown,
				html: "",
				files,
				assetFilesById,
				assets
			};
		}

		return {
			text,
			html,
			files,
			assetFilesById,
			assets
		};
	}

	function removeMarkdownAssetImages(markdown) {
		return String(markdown || "")
			.replace(/^\s*!\[[^\]]*]\(asset:\/\/[a-zA-Z0-9_-]+\)\s*$/gm, "")
			.replace(/!\[[^\]]*]\(asset:\/\/[a-zA-Z0-9_-]+\)/g, "");
	}

	function removeUnportableMarkdownImages(markdown) {
		return String(markdown || "")
			.replace(/^\s*!\[[^\]]*]\((?:asset:\/\/[a-zA-Z0-9_-]+|data:image\/[^)]+)\)\s*$/gim, "")
			.replace(/!\[[^\]]*]\((?:asset:\/\/[a-zA-Z0-9_-]+|data:image\/[^)]+)\)/gi, "");
	}

	function removeImagesFromHtml(html) {
		if (!html.trim()) {
			return "";
		}

		const template = document.createElement("template");
		template.innerHTML = html;
		for (const image of Array.from(template.content.querySelectorAll("img"))) {
			image.remove();
		}
		return template.innerHTML.trim();
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

	function buildAssetFileMap(assets) {
		const map = new Map();
		for (const asset of assets) {
			const file = assetToFile(asset);
			if (file && asset.id) {
				map.set(asset.id, file);
			}
		}
		return map;
	}

	function splitMarkdownAssetSegments(markdown, assetFilesById) {
		const segments = [];
		const pattern = /!\[([^\]]*)]\(asset:\/\/([a-zA-Z0-9_-]+)\)/g;
		let lastIndex = 0;
		let match;

		while ((match = pattern.exec(markdown)) !== null) {
			if (match.index > lastIndex) {
				segments.push({
					type: "text",
					value: markdown.slice(lastIndex, match.index)
				});
			}

			const file = assetFilesById.get(match[2]);
			if (file) {
				segments.push({
					type: "file",
					file
				});
			} else {
				segments.push({
					type: "text",
					value: match[0]
				});
			}
			lastIndex = pattern.lastIndex;
		}

		if (lastIndex < markdown.length) {
			segments.push({
				type: "text",
				value: markdown.slice(lastIndex)
			});
		}

		return segments.length > 0 ? segments : [{
			type: "text",
			value: markdown
		}];
	}

	function buildMarkdownImageUploadPlan(markdown, assetFilesById) {
		const images = [];
		const markdownParts = [];
		const pattern = /!\[([^\]]*)]\(asset:\/\/([a-zA-Z0-9_-]+)\)/g;
		let lastIndex = 0;
		let match;

		while ((match = pattern.exec(String(markdown || ""))) !== null) {
			if (match.index > lastIndex) {
				markdownParts.push({
					type: "text",
					value: String(markdown || "").slice(lastIndex, match.index)
				});
			}

			const alt = match[1].replace(/[\]\n\r]/g, " ").trim();
			const assetId = match[2];
			const file = assetFilesById.get(assetId);
			if (file) {
				const image = {
					type: "image",
					assetId,
					file,
					alt
				};
				images.push(image);
				markdownParts.push(image);
			} else {
				markdownParts.push({
					type: "text",
					value: match[0]
				});
			}
			lastIndex = pattern.lastIndex;
		}

		const source = String(markdown || "");
		if (lastIndex < source.length) {
			markdownParts.push({
				type: "text",
				value: source.slice(lastIndex)
			});
		}

		return {
			images,
			markdownParts
		};
	}

	function buildMarkdownAssetMarkerPlan(markdown, assets = []) {
		const byId = new Map();
		for (const asset of Array.isArray(assets) ? assets : []) {
			if (asset?.kind === "image" && asset.id && asset.base64) {
				byId.set(String(asset.id), asset);
			}
		}

		const images = [];
		const pattern = /!\[([^\]]*)]\(asset:\/\/([a-zA-Z0-9_-]+)\)/g;
		const output = String(markdown || "").replace(pattern, (match, alt, assetId) => {
			const asset = byId.get(assetId);
			if (!asset) {
				return match;
			}

			const marker = `[[OTP_IMAGE_${assetId}_${images.length + 1}]]`;
			images.push({
				asset,
				assetId,
				marker,
				alt: sanitizeImageAlt(alt || asset.fileName)
			});
			return marker;
		});

		return {
			markdown: output,
			images
		};
	}

	function buildMarkdownImageMarkerPlan(markdown, assetFilesById) {
		const images = [];
		const pattern = /!\[([^\]]*)]\(asset:\/\/([a-zA-Z0-9_-]+)\)/g;
		const output = String(markdown || "").replace(pattern, (match, alt, assetId) => {
			const file = assetFilesById.get(assetId);
			if (!file) {
				return match;
			}

			const marker = `[[OTP_IMAGE_${assetId}_${images.length + 1}]]`;
			images.push({
				assetId,
				file,
				marker
			});
			return marker;
		});

		return {
			markdown: output,
			images
		};
	}

	function selectMarkerText(target, marker) {
		target.focus();
		const view = getCodeMirrorView(target);
		if (view) {
			const text = view.state.doc.toString();
			const index = text.indexOf(marker);
			if (index < 0) {
				return false;
			}

			view.dispatch({
				selection: {
					anchor: index,
					head: index + marker.length
				},
				scrollIntoView: true
			});
			view.focus();
			return true;
		}

		if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
			const index = target.value.indexOf(marker);
			if (index < 0) {
				return false;
			}
			target.selectionStart = index;
			target.selectionEnd = index + marker.length;
			return true;
		}

		const range = findTextRange(target, marker);
		if (!range) {
			return false;
		}

		const selection = window.getSelection();
		if (!selection) {
			return false;
		}
		selection.removeAllRanges();
		selection.addRange(range);
		return true;
	}

	function removeMarkerText(target, marker) {
		return replaceTextInWritable(target, marker, "");
	}

	function findTextRange(root, needle) {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const index = node.textContent?.indexOf(needle) ?? -1;
			if (index < 0) {
				continue;
			}

			const range = document.createRange();
			range.setStart(node, index);
			range.setEnd(node, index + needle.length);
			return range;
		}

		return null;
	}

	function getWritableText(target) {
		const view = getCodeMirrorView(target);
		if (view) {
			return view.state.doc.toString();
		}

		if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
			return target.value;
		}

		return target.textContent || "";
	}

	async function waitForCondition(check, timeoutMs, intervalMs) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			if (check()) {
				return true;
			}
			await delay(intervalMs);
		}

		return false;
	}

	async function waitForValue(getValue, timeoutMs, intervalMs) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			const value = getValue();
			if (value) {
				return value;
			}
			await delay(intervalMs);
		}

		return null;
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

	function isVisibleElement(element) {
		if (!element.isConnected) {
			return false;
		}

		const rect = element.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) {
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
