(function () {
	const EDITOR_SELECTOR = ".tiptap.ProseMirror[contenteditable='true'],.ProseMirror[contenteditable='true']";

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

	function findMarkerBlock(doc, marker) {
		const location = findMarker(doc, marker);
		if (!location) {
			return null;
		}
		const resolved = doc.resolve(location.from);
		if (resolved.depth < 1) {
			return null;
		}
		return {
			...location,
			pos: resolved.before(1),
			node: resolved.node(1)
		};
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
		const occurrences = new Map();
		doc.forEach((node, pos, index) => {
			if (nodeContainsImage(node)) {
				const fingerprint = getImageBlockFingerprint(node);
				const occurrence = (occurrences.get(fingerprint) || 0) + 1;
				occurrences.set(fingerprint, occurrence);
				blocks.push({
					node,
					pos,
					index,
					fingerprint,
					occurrence
				});
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

	function getImageBlockFingerprint(node) {
		const imageParts = [];
		const collect = (candidate) => {
			if (isImageNode(candidate)) {
				imageParts.push(`${candidate?.type?.name || "image"}:${stableStringify(candidate?.attrs || {})}`);
			}
		};
		collect(node);
		node.descendants?.((child) => {
			collect(child);
			return true;
		});
		return hashString(imageParts.join("|"));
	}

	function stableStringify(value, seen = new WeakSet()) {
		if (value == null || typeof value !== "object") {
			return JSON.stringify(value);
		}
		if (seen.has(value)) {
			return '"[circular]"';
		}
		seen.add(value);
		if (Array.isArray(value)) {
			return `[${value.map((item) => stableStringify(item, seen)).join(",")}]`;
		}
		const keys = Object.keys(value).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`).join(",")}}`;
	}

	function hashString(value) {
		let hash = 2166136261;
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(16);
	}

	function captureImageFingerprintCounts(doc) {
		const counts = new Map();
		for (const entry of getTopLevelImageBlocks(doc)) {
			counts.set(entry.fingerprint, (counts.get(entry.fingerprint) || 0) + 1);
		}
		return counts;
	}

	function findNewImageBlock(doc, beforeCounts) {
		return findNewImageBlocks(doc, beforeCounts)[0] || null;
	}

	function findNewImageBlocks(doc, beforeCounts) {
		return getTopLevelImageBlocks(doc).filter(
			(entry) => entry.occurrence > (beforeCounts.get(entry.fingerprint) || 0)
		);
	}

	function buildImageDeduplicationPlan(imageBlocks, markerPos) {
		const ordered = Array.from(imageBlocks || []).sort((left, right) => left.pos - right.pos);
		const beforeMarker = ordered.filter((entry) => entry.pos < markerPos);
		const keep = beforeMarker[beforeMarker.length - 1] || ordered[0] || null;
		return {
			keep,
			remove: keep ? ordered.filter((entry) => entry !== keep) : []
		};
	}

	function deduplicateNewImageBlocksAtMarker(view, marker, beforeCounts) {
		try {
			const markerBlock = findMarkerBlock(view.state.doc, marker);
			if (!markerBlock) {
				return { ok: false, removed: 0 };
			}
			const plan = buildImageDeduplicationPlan(
				findNewImageBlocks(view.state.doc, beforeCounts),
				markerBlock.pos
			);
			if (!plan.keep) {
				return { ok: false, removed: 0 };
			}
			if (plan.remove.length === 0) {
				return { ok: true, removed: 0 };
			}

			let transaction = view.state.tr;
			for (const entry of [...plan.remove].sort((left, right) => right.pos - left.pos)) {
				transaction = transaction.delete(entry.pos, entry.pos + entry.node.nodeSize);
			}
			view.dispatch(transaction.scrollIntoView());
			return { ok: true, removed: plan.remove.length };
		} catch (_error) {
			return { ok: false, removed: 0 };
		}
	}

	function hasImageImmediatelyBeforeMarker(doc, marker, maxEmptyBlocks = 2) {
		const markerBlock = findMarkerBlock(doc, marker);
		if (!markerBlock) {
			return false;
		}
		const blocks = [];
		doc.forEach((node, pos) => blocks.push({ node, pos }));
		const markerIndex = blocks.findIndex((entry) => entry.pos === markerBlock.pos);
		let emptyBlocks = 0;
		for (let index = markerIndex - 1; index >= 0 && emptyBlocks <= maxEmptyBlocks; index -= 1) {
			const node = blocks[index].node;
			if (nodeContainsImage(node)) {
				return true;
			}
			if (String(node.textContent || "").trim()) {
				return false;
			}
			emptyBlocks += 1;
		}
		return false;
	}

	function removeMarker(view, marker) {
		try {
			const markerBlock = findMarkerBlock(view.state.doc, marker);
			if (!markerBlock) {
				return false;
			}
			let transaction = view.state.tr;
			if (String(markerBlock.node.textContent || "").trim() === marker) {
				transaction = transaction.delete(markerBlock.pos, markerBlock.pos + markerBlock.node.nodeSize);
			} else {
				transaction = transaction.delete(markerBlock.from, markerBlock.to);
			}
			view.dispatch(transaction.scrollIntoView());
			return !findMarker(view.state.doc, marker);
		} catch (_error) {
			return false;
		}
	}

	function relocateImageBlockToMarker(view, marker, imageIdentity) {
		try {
			if (hasImageImmediatelyBeforeMarker(view.state.doc, marker)) {
				return removeMarker(view, marker);
			}
			const imageFingerprint = typeof imageIdentity === "string"
				? imageIdentity
				: imageIdentity?.fingerprint;
			const imageOccurrence = typeof imageIdentity === "string"
				? null
				: imageIdentity?.occurrence;
			let transaction = view.state.tr;
			const imageBlock = getTopLevelImageBlocks(transaction.doc)
				.find((entry) => (
					entry.fingerprint === imageFingerprint
					&& (imageOccurrence == null || entry.occurrence === imageOccurrence)
				));
			if (!imageBlock) {
				return false;
			}
			const imageNode = imageBlock.node;
			transaction = transaction.delete(imageBlock.pos, imageBlock.pos + imageNode.nodeSize);

			const markerBlock = findMarkerBlock(transaction.doc, marker);
			if (!markerBlock) {
				return false;
			}
			if (String(markerBlock.node.textContent || "").trim() === marker) {
				transaction = transaction.replaceWith(
					markerBlock.pos,
					markerBlock.pos + markerBlock.node.nodeSize,
					imageNode
				);
			} else {
				transaction = transaction.delete(markerBlock.from, markerBlock.to);
				transaction = transaction.insert(markerBlock.pos, imageNode);
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

	const api = {
		findEditorRoot,
		findEditorView,
		findMarker,
		placeSelectionAtMarker,
		getTopLevelImageBlocks,
		captureImageFingerprintCounts,
		findNewImageBlock,
		findNewImageBlocks,
		buildImageDeduplicationPlan,
		deduplicateNewImageBlocksAtMarker,
		hasImageImmediatelyBeforeMarker,
		removeMarker,
		relocateImageBlockToMarker,
		dispatchFilePaste,
		base64ToFile,
		waitForValue,
		waitForCondition,
		delay
	};

	globalThis.OTPProseMirrorCore = api;
	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
})();
