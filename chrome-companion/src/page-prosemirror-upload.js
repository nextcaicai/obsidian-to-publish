(function () {
	const REQUEST_SOURCE = "OTP_COMPANION_PROSEMIRROR_UPLOAD_REQUEST_V1";
	const RESPONSE_SOURCE = "OTP_COMPANION_PROSEMIRROR_UPLOAD_RESPONSE_V1";
	const EDITOR_SELECTOR = ".tiptap.ProseMirror[contenteditable='true'],.ProseMirror[contenteditable='true']";

	window.addEventListener("message", (event) => {
		if (event.source !== window || event.data?.source !== REQUEST_SOURCE) {
			return;
		}
		void handleUploadRequest(event.data);
	});

	async function handleUploadRequest(message) {
		const assets = Array.isArray(message.assets) ? message.assets : [];
		const options = message.options || {};
		const editorContext = await waitForValue(
			() => {
				const root = findEditorRoot();
				const view = root ? findEditorView(root) : null;
				return root && view ? { root, view } : null;
			},
			options.editorWaitMs || 10000,
			150
		);
		if (!editorContext) {
			postResponse(message.requestId, false, [], false, "ProseMirror editor state was not reachable.");
			return;
		}

		const markers = assets.map((asset) => String(asset?.marker || "")).filter(Boolean);
		const markersReady = await waitForCondition(
			() => {
				const latestView = findEditorView(editorContext.root) || editorContext.view;
				return markers.every((marker) => findMarker(latestView.state.doc, marker));
			},
			options.markerWaitMs || 10000,
			150
		);
		if (!markersReady) {
			postResponse(message.requestId, false, [], false, "Image markers did not reach the ProseMirror editor state.");
			return;
		}

		const uploads = [];
		for (const asset of assets) {
			const latestView = findEditorView(editorContext.root) || editorContext.view;
			uploads.push(await uploadAssetAtMarker(latestView, editorContext.root, asset, options));
		}
		postResponse(message.requestId, true, uploads, true);
	}

	function postResponse(requestId, ok, uploads, started, error = "") {
		window.postMessage({
			source: RESPONSE_SOURCE,
			requestId,
			ok,
			uploads,
			started,
			...(error ? { error } : {})
		}, window.location.origin);
	}

	async function uploadAssetAtMarker(view, root, asset, options) {
		const marker = String(asset?.marker || "");
		if (!marker) {
			return { ok: false, placed: false, error: "Image marker is missing." };
		}
		if (!placeSelectionAtMarker(view, marker)) {
			return { ok: false, placed: false, error: "Image marker was not found in the ProseMirror editor." };
		}

		let file;
		try {
			file = base64ToFile(
				String(asset.base64 || ""),
				String(asset.name || asset.fileName || "image.png"),
				String(asset.type || asset.mime || "image/png")
			);
		} catch (error) {
			return { ok: false, placed: false, error: error?.message || "Image data was invalid." };
		}

		const beforeImageNodes = new Set(getTopLevelImageBlocks(view.state.doc).map((entry) => entry.node));
		await delay(60);
		const uploadStarted = dispatchFilePaste(root, file);
		if (!uploadStarted) {
			return { ok: false, placed: false, error: "The editor rejected the image paste event." };
		}

		const uploadedImage = await waitForValue(
			() => {
				const latestView = findEditorView(root) || view;
				const imageBlock = findNewImageBlock(latestView.state.doc, beforeImageNodes);
				return imageBlock ? { view: latestView, imageBlock } : null;
			},
			options.imageUploadWaitMs || 60000,
			300
		);
		if (!uploadedImage) {
			return {
				ok: false,
				placed: false,
				error: "Image upload did not create a ProseMirror image block before timeout.",
				marker
			};
		}

		const placed = relocateImageBlockToMarker(
			uploadedImage.view,
			marker,
			uploadedImage.imageBlock.node
		);
		return placed
			? { ok: true, placed: true, markerCleaned: true, marker }
			: {
				ok: false,
				placed: false,
				error: "The image uploaded, but its ProseMirror block could not be moved to the marker.",
				markerCleaned: false,
				marker
			};
	}

	function findEditorRoot() {
		for (const element of Array.from(document.querySelectorAll(EDITOR_SELECTOR))) {
			const rect = element.getBoundingClientRect();
			if (rect.width > 200 && rect.height > 80) {
				return element;
			}
		}
		return null;
	}

	function findEditorView(root) {
		const queue = [];
		const visited = new WeakSet();
		for (let element = root, depth = 0; element && depth < 8; element = element.parentElement, depth += 1) {
			queue.push(element);
			for (const key of getOwnPropertyNames(element)) {
				if (/editor|view|tiptap|react|vue/i.test(key)) {
					queue.push(readProperty(element, key));
				}
			}
		}

		const traversalKeys = [
			"editor", "editorView", "view", "props", "memoizedProps", "pendingProps", "stateNode",
			"memoizedState", "return", "child", "sibling", "parent", "setupState", "ctx", "proxy",
			"exposed", "subTree", "component", "$", "value", "__v_raw", "spec"
		];
		for (let cursor = 0; cursor < queue.length && cursor < 2500; cursor += 1) {
			const candidate = queue[cursor];
			if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) {
				continue;
			}
			if (visited.has(candidate)) {
				continue;
			}
			visited.add(candidate);
			if (isEditorView(candidate, root)) {
				return candidate;
			}
			for (const key of traversalKeys) {
				const value = readProperty(candidate, key);
				if (value && (typeof value === "object" || typeof value === "function")) {
					queue.push(value);
				}
			}
		}
		return null;
	}

	function isEditorView(candidate, root) {
		try {
			return Boolean(
				candidate?.state?.doc
				&& candidate?.state?.tr
				&& typeof candidate.dispatch === "function"
				&& candidate.dom instanceof HTMLElement
				&& (candidate.dom === root || candidate.dom.contains(root) || root.contains(candidate.dom))
			);
		} catch (_error) {
			return false;
		}
	}

	function getOwnPropertyNames(value) {
		try {
			return Object.getOwnPropertyNames(value);
		} catch (_error) {
			return [];
		}
	}

	function readProperty(value, key) {
		try {
			return value?.[key];
		} catch (_error) {
			return null;
		}
	}

	function findMarker(doc, marker) {
		let location = null;
		doc.descendants((node, pos) => {
			if (location || !node.isText) {
				return;
			}
			const offset = String(node.text || "").indexOf(marker);
			if (offset >= 0) {
				location = {
					from: pos + offset,
					to: pos + offset + marker.length
				};
			}
		});
		return location;
	}

	function placeSelectionAtMarker(view, marker) {
		const location = findMarker(view.state.doc, marker);
		const Selection = view.state.selection?.constructor;
		if (!location || typeof Selection?.near !== "function") {
			return false;
		}
		try {
			const selection = Selection.near(view.state.doc.resolve(location.from), 1);
			view.dispatch(view.state.tr.setSelection(selection));
			view.focus();
			return true;
		} catch (_error) {
			return false;
		}
	}

	function getTopLevelImageBlocks(doc) {
		const blocks = [];
		doc.forEach((node, pos, index) => {
			if (nodeContainsImage(node)) {
				blocks.push({ node, pos, index });
			}
		});
		return blocks;
	}

	function nodeContainsImage(node) {
		if (isImageNode(node)) {
			return true;
		}
		let found = false;
		node.descendants?.((child) => {
			if (isImageNode(child)) {
				found = true;
				return false;
			}
			return !found;
		});
		return found;
	}

	function isImageNode(node) {
		const typeName = String(node?.type?.name || "");
		const src = String(node?.attrs?.src || node?.attrs?.url || "");
		return /image|figure|media/i.test(typeName) || Boolean(src && /^(blob:|data:|https?:)/i.test(src));
	}

	function findNewImageBlock(doc, previousNodes) {
		const imageBlocks = getTopLevelImageBlocks(doc);
		return imageBlocks.find((entry) => !previousNodes.has(entry.node)) || null;
	}

	function relocateImageBlockToMarker(view, marker, imageNode) {
		try {
			let transaction = view.state.tr;
			const imageBlock = getTopLevelImageBlocks(transaction.doc).find((entry) => entry.node === imageNode);
			if (!imageBlock) {
				return false;
			}
			transaction = transaction.delete(imageBlock.pos, imageBlock.pos + imageBlock.node.nodeSize);

			const markerLocation = findMarker(transaction.doc, marker);
			if (!markerLocation) {
				return false;
			}
			const resolvedMarker = transaction.doc.resolve(markerLocation.from);
			if (resolvedMarker.depth < 1) {
				return false;
			}
			const markerBlockPos = resolvedMarker.before(1);
			const markerBlock = resolvedMarker.node(1);
			if (String(markerBlock.textContent || "").trim() === marker) {
				transaction = transaction.replaceWith(
					markerBlockPos,
					markerBlockPos + markerBlock.nodeSize,
					imageNode
				);
			} else {
				transaction = transaction.delete(markerLocation.from, markerLocation.to);
				transaction = transaction.insert(markerBlockPos, imageNode);
			}

			view.dispatch(transaction.scrollIntoView());
			return !findMarker(view.state.doc, marker);
		} catch (_error) {
			return false;
		}
	}

	function dispatchFilePaste(target, file) {
		try {
			const transfer = new DataTransfer();
			transfer.items.add(file);
			const event = new ClipboardEvent("paste", {
				bubbles: true,
				cancelable: true,
				clipboardData: transfer
			});
			target.dispatchEvent(event);
			return transfer.files.length === 1;
		} catch (_error) {
			return false;
		}
	}

	function base64ToFile(base64, fileName, mime) {
		if (!base64) {
			throw new Error("Image data is empty.");
		}
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return new File([bytes], fileName, { type: mime });
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

	async function waitForCondition(check, timeoutMs, intervalMs) {
		return Boolean(await waitForValue(() => check() || null, timeoutMs, intervalMs));
	}

	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
})();
