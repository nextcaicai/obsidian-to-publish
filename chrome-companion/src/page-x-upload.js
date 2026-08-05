(function () {
	const REQUEST_SOURCE = "OTP_COMPANION_X_UPLOAD_REQUEST_V1";
	const RESPONSE_SOURCE = "OTP_COMPANION_X_UPLOAD_RESPONSE_V1";
	const EDITOR_SELECTOR = [
		"[data-contents='true'] [contenteditable='true']",
		"[contenteditable='true'][role='textbox']",
		"[contenteditable='true'].public-DraftEditor-content",
		"[contenteditable='true']"
	].join(",");

	window.addEventListener("message", (event) => {
		if (event.source !== window || event.data?.source !== REQUEST_SOURCE) {
			return;
		}

		void handleUploadRequest(event.data);
	});

	async function handleUploadRequest(message) {
		const assets = Array.isArray(message.assets) ? message.assets : [];
		const options = message.options || {};
		let bodyWritten = false;
		if (typeof message.markdown === "string") {
			const draftNode = await waitForValue(
				() => findDraftStateNode(),
				options.editorWaitMs || 8000,
				150
			);
			if (!draftNode) {
				postResponse(message.requestId, false, [], false, "X article editor was not reachable.");
				return;
			}

			const writableNode = await ensureDraftCharacterSample(draftNode);
			const writeResult = writeDraftMarkdown(writableNode, message.markdown);
			if (!writeResult.ok) {
				postResponse(message.requestId, false, [], false, writeResult.error);
				return;
			}
			bodyWritten = true;

			const markers = assets.map((asset) => String(asset?.marker || "")).filter(Boolean);
			if (markers.length > 0) {
				const markersReady = await waitForCondition(
					() => {
						const latestNode = findDraftStateNode();
						const content = latestNode?.props?.editorState?.getCurrentContent?.();
						return Boolean(content) && markers.every((marker) => findMarkerLocation(content, marker));
					},
					options.markerWaitMs || 5000,
					150
				);
				if (!markersReady) {
					postResponse(message.requestId, false, [], true, "X image markers did not reach the Draft.js editor state.");
					return;
				}
			}
		}

		const uploads = [];
		for (const asset of assets) {
			uploads.push(await uploadAssetAtMarker(asset, options));
		}

		postResponse(message.requestId, true, uploads, bodyWritten);
	}

	function postResponse(requestId, ok, uploads, bodyWritten, error = "") {
		window.postMessage({
			source: RESPONSE_SOURCE,
			requestId,
			ok,
			uploads,
			bodyWritten,
			...(error ? { error } : {})
		}, window.location.origin);
	}

	async function uploadAssetAtMarker(asset, options) {
		const marker = String(asset?.marker || "");
		if (!marker) {
			return { ok: false, error: "Image marker is missing." };
		}

		const draftNode = await waitForValue(
			() => findDraftStateNode(),
			options.editorWaitMs || 8000,
			150
		);
		if (!draftNode) {
			return { ok: false, error: "X article editor was not reachable." };
		}

		const onFilesAdded = findOnFilesAdded();
		if (!onFilesAdded) {
			return { ok: false, error: "X image upload handler was not reachable." };
		}

		const markerPlaced = placeSelectionAtMarker(draftNode, marker);
		if (!markerPlaced) {
			return { ok: false, error: "Image marker was not found in the X editor." };
		}

		let file;
		try {
			file = base64ToFile(
				String(asset.base64 || ""),
				String(asset.name || asset.fileName || "image.png"),
				String(asset.type || asset.mime || "image/png")
			);
		} catch (error) {
			return { ok: false, error: error?.message || "Image data was invalid." };
		}

		await delay(80);
		const beforeMediaKeys = getMediaBlockKeys(draftNode);
		try {
			onFilesAdded([file]);
		} catch (error) {
			return { ok: false, error: error?.message || "X image upload handler failed." };
		}

		const uploadedMedia = await waitForValue(
			() => {
				const latestNode = findDraftStateNode() || draftNode;
				const mediaKey = findNewMediaBlockKey(latestNode, beforeMediaKeys);
				return mediaKey ? { draftNode: latestNode, mediaKey } : null;
			},
			options.imageUploadWaitMs || 60000,
			350
		);
		if (!uploadedMedia) {
			return {
				ok: false,
				placed: false,
				error: "X image upload did not create a media block before timeout.",
				markerCleaned: false,
				marker
			};
		}

		const placed = relocateMediaBlockToMarker(
			uploadedMedia.draftNode,
			marker,
			uploadedMedia.mediaKey
		);
		if (!placed) {
			return {
				ok: false,
				placed: false,
				error: "X uploaded the image, but its media block could not be moved to the marker.",
				markerCleaned: false,
				marker
			};
		}

		return {
			ok: true,
			placed: true,
			mediaDetected: true,
			markerCleaned: true,
			marker
		};
	}

	function findEditorElement() {
		for (const element of Array.from(document.querySelectorAll(EDITOR_SELECTOR))) {
			const rect = element.getBoundingClientRect();
			if (rect.width > 200 && rect.height > 80) {
				return element;
			}
		}
		return null;
	}

	function findReactFiber(element) {
		if (!element) {
			return null;
		}
		const fiberKey = Object.keys(element).find((key) =>
			key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
		);
		return fiberKey ? element[fiberKey] : null;
	}

	function findDraftStateNode() {
		let fiber = findReactFiber(findEditorElement());
		for (let depth = 0; depth < 80 && fiber; depth += 1) {
			const stateNode = fiber.stateNode;
			if (stateNode?.props?.editorState && typeof stateNode.props.onChange === "function") {
				return stateNode;
			}
			fiber = fiber.return;
		}
		return null;
	}

	function findDraftCharacterSample(draftNode) {
		const blockMap = draftNode?.props?.editorState?.getCurrentContent?.()?.getBlockMap?.();
		if (!blockMap?.forEach) {
			return null;
		}

		let sample = null;
		blockMap.forEach((block) => {
			if (sample) {
				return;
			}
			const characterList = block?.getCharacterList?.();
			const size = typeof characterList?.size === "number" ? characterList.size : 0;
			for (let index = 0; index < size; index += 1) {
				const character = characterList.get?.(index);
				if (character?.set && character?.getStyle) {
					sample = { block, character };
					break;
				}
			}
		});
		return sample;
	}

	async function ensureDraftCharacterSample(draftNode) {
		if (findDraftCharacterSample(draftNode)) {
			return draftNode;
		}

		const editor = findEditorElement();
		if (!editor) {
			return draftNode;
		}
		editor.focus();
		document.execCommand("insertText", false, "x");
		return await waitForValue(() => {
			const latestNode = findDraftStateNode() || draftNode;
			return findDraftCharacterSample(latestNode) ? latestNode : null;
		}, 1800, 80) || draftNode;
	}

	function writeDraftMarkdown(draftNode, markdown) {
		const sample = findDraftCharacterSample(draftNode);
		if (!sample) {
			return { ok: false, error: "X Draft.js character metadata was not reachable." };
		}

		const editorState = draftNode.props.editorState;
		const EditorState = editorState.constructor;
		const SelectionState = editorState.getSelection().constructor;
		const contentState = editorState.getCurrentContent();
		const BlockMap = contentState.getBlockMap().constructor;
		const CharacterList = sample.block.getCharacterList().constructor;
		let nextBlockMap = BlockMap();
		let lastKey = "";
		const lines = String(markdown || "").split(/\r?\n/);

		for (let index = 0; index < Math.max(1, lines.length); index += 1) {
			const text = lines[index] || "";
			const key = `${Math.random().toString(36).slice(2, 7)}${index.toString(36)}`;
			let characterList = CharacterList();
			const emptyStyle = sample.character.getStyle().clear();
			for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
				characterList = characterList.push(sample.character.set("style", emptyStyle).set("entity", null));
			}
			const block = sample.block.merge({
				key,
				type: "unstyled",
				text,
				characterList,
				depth: 0,
				data: sample.block.getData?.()?.clear?.() || sample.block.getData?.()
			});
			nextBlockMap = nextBlockMap.set(key, block);
			lastKey = key;
		}

		if (!lastKey) {
			return { ok: false, error: "X article body was empty." };
		}

		const selection = SelectionState.createEmpty(lastKey);
		const nextContent = contentState
			.set("blockMap", nextBlockMap)
			.set("selectionBefore", selection)
			.set("selectionAfter", selection);
		let nextEditorState = EditorState.push(editorState, nextContent, "insert-fragment");
		nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
		draftNode.props.onChange(nextEditorState);
		return { ok: true };
	}

	function findOnFilesAdded() {
		let fiber = findReactFiber(findEditorElement());
		for (let depth = 0; depth < 160 && fiber; depth += 1) {
			const props = fiber.memoizedProps || fiber.stateNode?.props;
			if (typeof props?.onFilesAdded === "function") {
				return props.onFilesAdded;
			}
			const nested = findOnFilesAddedInChildren(fiber.child, 0);
			if (nested) {
				return nested;
			}
			fiber = fiber.return;
		}
		return null;
	}

	function findOnFilesAddedInChildren(fiber, depth) {
		if (!fiber || depth > 8) {
			return null;
		}
		const props = fiber.memoizedProps || fiber.stateNode?.props;
		if (typeof props?.onFilesAdded === "function") {
			return props.onFilesAdded;
		}
		return findOnFilesAddedInChildren(fiber.child, depth + 1)
			|| findOnFilesAddedInChildren(fiber.sibling, depth);
	}

	function placeSelectionAtMarker(draftNode, marker) {
		const editorState = draftNode.props.editorState;
		const SelectionState = editorState.getSelection().constructor;
		const EditorState = editorState.constructor;
		const contentState = editorState.getCurrentContent();
		const location = findMarkerLocation(contentState, marker);
		if (!location) {
			return null;
		}

		const selection = SelectionState.createEmpty(location.blockKey).merge({
			anchorOffset: location.offset,
			focusOffset: location.offset
		});
		draftNode.props.onChange(EditorState.forceSelection(editorState, selection));
		return location;
	}

	function findMarkerLocation(contentState, marker) {
		let location = null;
		contentState.getBlockMap().forEach((block, key) => {
			if (location || block.getType() === "atomic") {
				return;
			}
			const text = block.getText() || "";
			const offset = text.indexOf(marker);
			if (offset < 0) {
				return;
			}
			location = {
				blockKey: key,
				offset,
				length: marker.length,
				exact: text.trim() === marker
			};
		});
		return location;
	}

	function relocateMediaBlockToMarker(draftNode, marker, mediaKey) {
		const editorState = draftNode?.props?.editorState;
		const contentState = editorState?.getCurrentContent?.();
		const blockMap = contentState?.getBlockMap?.();
		const location = contentState ? findMarkerLocation(contentState, marker) : null;
		const mediaBlock = blockMap?.get?.(mediaKey);
		if (!editorState || !contentState || !blockMap?.forEach || !location || !mediaBlock) {
			return false;
		}

		const EditorState = editorState.constructor;
		const SelectionState = editorState.getSelection().constructor;
		let nextBlockMap = blockMap.clear();
		let markerBlockPreserved = false;
		blockMap.forEach((block, key) => {
			if (key === mediaKey) {
				return;
			}
			if (key !== location.blockKey) {
				nextBlockMap = nextBlockMap.set(key, block);
				return;
			}

			nextBlockMap = nextBlockMap.set(mediaKey, mediaBlock);
			if (!location.exact) {
				const cleanedBlock = removeMarkerFromBlock(block, location);
				if (cleanedBlock) {
					nextBlockMap = nextBlockMap.set(key, cleanedBlock);
					markerBlockPreserved = true;
				}
			}
		});

		if (!nextBlockMap.has?.(mediaKey)) {
			return false;
		}
		const selectionKey = markerBlockPreserved ? location.blockKey : mediaKey;
		const selection = SelectionState.createEmpty(selectionKey);
		const nextContent = contentState
			.set("blockMap", nextBlockMap)
			.set("selectionBefore", selection)
			.set("selectionAfter", selection);
		let nextEditorState = EditorState.push(editorState, nextContent, "insert-fragment");
		nextEditorState = EditorState.forceSelection(nextEditorState, selection);
		draftNode.props.onChange(nextEditorState);
		return true;
	}

	function removeMarkerFromBlock(block, location) {
		const currentText = block.getText() || "";
		const nextText = `${currentText.slice(0, location.offset)}${currentText.slice(location.offset + location.length)}`;
		const sourceList = block.getCharacterList?.();
		let characterList = sourceList?.slice?.(0, location.offset)
			?.concat?.(sourceList.slice(location.offset + location.length));
		if (!characterList || characterList.size !== nextText.length) {
			characterList = rebuildCharacterList(block, nextText.length);
		}
		return characterList ? block.merge({ text: nextText, characterList }) : null;
	}

	function rebuildCharacterList(block, length) {
		const sourceList = block.getCharacterList?.();
		const sampleCharacter = sourceList?.first?.() || sourceList?.get?.(0);
		if (!sourceList?.clear || !sampleCharacter) {
			return null;
		}
		return sourceList.clear().concat(Array.from({ length }, () => sampleCharacter));
	}

	function getMediaBlockKeys(draftNode) {
		const contentState = draftNode?.props?.editorState?.getCurrentContent?.();
		if (!contentState?.getBlockMap) {
			return new Set();
		}

		const keys = new Set();
		contentState.getBlockMap().forEach((block, key) => {
			if (block.getType() === "atomic") {
				keys.add(key);
			}
		});
		return keys;
	}

	function findNewMediaBlockKey(draftNode, previousKeys) {
		for (const key of getMediaBlockKeys(draftNode)) {
			if (!previousKeys.has(key)) {
				return key;
			}
		}
		return "";
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
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			if (check()) {
				return true;
			}
			await delay(intervalMs);
		}
		return false;
	}

	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
})();
