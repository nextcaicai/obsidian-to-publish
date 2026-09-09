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
		const usedMediaBlocks = new Set();
		for (const asset of assets) {
			uploads.push(await uploadAssetAtMarker(asset, options, usedMediaBlocks));
		}

		const successfulUploads = uploads.filter((upload) => upload?.ok && upload?.blockKey);
		if (successfulUploads.length > 0) {
			await delay(options.mediaSettleDelayMs || 700);
			const latestNode = findDraftStateNode();
			const movedMarkers = latestNode
				? relocateMediaBlocksToMarkers(latestNode, successfulUploads)
				: new Set();
			await delay(250);
			const verifiedNode = findDraftStateNode() || latestNode;
			for (const upload of successfulUploads) {
				const markerStillPresent = Boolean(
					verifiedNode?.props?.editorState?.getCurrentContent
					&& findMarkerLocation(verifiedNode.props.editorState.getCurrentContent(), upload.marker)
				);
				upload.placed = movedMarkers.has(upload.marker) && !markerStillPresent;
				upload.markerCleaned = !markerStillPresent;
				if (!upload.placed) {
					upload.ok = false;
					upload.error = "X uploaded the image, but its media block could not be matched to the marker.";
				}
			}
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

	async function uploadAssetAtMarker(asset, options, usedMediaBlocks) {
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
		const beforeMediaEntities = getMediaEntityKeys(draftNode);
		try {
			onFilesAdded([file]);
		} catch (error) {
			return { ok: false, error: error?.message || "X image upload handler failed." };
		}

		const uploadedMedia = await waitForStableMediaUpload(
			draftNode,
			beforeMediaEntities,
			usedMediaBlocks,
			options.imageUploadWaitMs || 60000
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

		usedMediaBlocks.add(uploadedMedia.blockKey);

		return {
			ok: true,
			placed: false,
			mediaDetected: true,
			markerCleaned: false,
			marker,
			blockKey: uploadedMedia.blockKey,
			entityKey: uploadedMedia.entityKey
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
		const blocks = globalThis.OTPXMarkdown?.markdownToDraftBlocks?.(markdown);
		if (!Array.isArray(blocks) || blocks.length === 0) {
			return { ok: false, error: "X Markdown formatter was not reachable." };
		}

		for (let index = 0; index < blocks.length; index += 1) {
			const { text, type, inlineStyleRanges = [] } = blocks[index];
			const key = `${Math.random().toString(36).slice(2, 7)}${index.toString(36)}`;
			let characterList = CharacterList();
			const emptyStyle = sample.character.getStyle().clear();
			for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
				let style = emptyStyle;
				for (const range of inlineStyleRanges) {
					if (range.style === "BOLD" && charIndex >= range.offset && charIndex < range.offset + range.length) {
						style = style.add("BOLD");
					}
				}
				characterList = characterList.push(sample.character.set("style", style).set("entity", null));
			}
			const block = sample.block.merge({
				key,
				type,
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

	function relocateMediaBlocksToMarkers(draftNode, uploads) {
		const editorState = draftNode?.props?.editorState;
		const contentState = editorState?.getCurrentContent?.();
		const blockMap = contentState?.getBlockMap?.();
		if (!editorState || !contentState || !blockMap?.forEach) {
			return new Set();
		}

		const entityToBlock = new Map();
		blockMap.forEach((block, blockKey) => {
			visitMediaEntities(contentState, block, (entityKey) => {
				if (!entityToBlock.has(entityKey)) {
					entityToBlock.set(entityKey, blockKey);
				}
			});
		});

		const moves = new Map();
		const destinationBlocks = new Set();
		for (const upload of uploads) {
			const location = findMarkerLocation(contentState, upload.marker);
			const mediaKey = blockMap.has?.(upload.blockKey)
				? upload.blockKey
				: entityToBlock.get(upload.entityKey);
			if (!location || !mediaKey || destinationBlocks.has(mediaKey)) {
				continue;
			}
			moves.set(location.blockKey, {
				marker: upload.marker,
				mediaKey,
				location
			});
			destinationBlocks.add(mediaKey);
		}

		if (moves.size === 0) {
			return new Set();
		}
		const orderTools = globalThis.OTPPageEditorOrder;
		if (!orderTools?.buildReplacementOrder) {
			return new Set();
		}
		const blockKeys = [];
		blockMap.forEach((_block, key) => blockKeys.push(key));
		const orderedKeys = orderTools.buildReplacementOrder(
			blockKeys,
			Array.from(moves.entries()).map(([markerKey, move]) => ({
				markerKey,
				mediaKey: move.mediaKey,
				preserveMarker: !move.location.exact
			}))
		);
		let nextBlockMap = blockMap.clear();
		const movedMarkers = new Set();
		const cleanedMarkerBlocks = new Map();
		for (const [markerKey, move] of moves) {
			if (!move.location.exact) {
				const cleanedBlock = removeMarkerFromBlock(blockMap.get(markerKey), move.location);
				if (cleanedBlock) {
					cleanedMarkerBlocks.set(markerKey, cleanedBlock);
				}
			}
			movedMarkers.add(move.marker);
		}
		for (const key of orderedKeys) {
			const block = cleanedMarkerBlocks.get(key) || blockMap.get(key);
			if (block) {
				nextBlockMap = nextBlockMap.set(key, block);
			}
		}

		const EditorState = editorState.constructor;
		const SelectionState = editorState.getSelection().constructor;
		const lastKey = nextBlockMap.last?.()?.getKey?.() || nextBlockMap.keySeq?.().last?.();
		const selection = lastKey ? SelectionState.createEmpty(lastKey) : editorState.getSelection();
		const nextContent = contentState
			.set("blockMap", nextBlockMap)
			.set("selectionBefore", selection)
			.set("selectionAfter", selection);
		let nextEditorState = EditorState.push(editorState, nextContent, "remove-range");
		nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
		draftNode.props.onChange(nextEditorState);
		return movedMarkers;
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

	function getMediaEntityKeys(draftNode) {
		const contentState = draftNode?.props?.editorState?.getCurrentContent?.();
		if (!contentState?.getBlockMap) {
			return new Set();
		}

		const entityKeys = new Set();
		contentState.getBlockMap().forEach((block) => {
			visitMediaEntities(contentState, block, (entityKey) => entityKeys.add(entityKey));
		});
		return entityKeys;
	}

	function visitMediaEntities(contentState, block, visitor) {
		if (block?.getType?.() !== "atomic" || typeof block.findEntityRanges !== "function") {
			return;
		}
		block.findEntityRanges(
			(character) => Boolean(character.getEntity?.()),
			(start) => {
				const entityKey = block.getCharacterList?.().get?.(start)?.getEntity?.();
				if (!entityKey) {
					return;
				}
				try {
					const entity = contentState.getEntity(entityKey);
					if (entity.getType() === "MEDIA") {
						visitor(entityKey, entity.getData?.() || {});
					}
				} catch (_error) {
					// The entity may be replaced while X finalizes the upload.
				}
			}
		);
	}

	function findNewMediaUpload(draftNode, previousEntities, ignoredBlocks) {
		const contentState = draftNode?.props?.editorState?.getCurrentContent?.();
		if (!contentState?.getBlockMap) {
			return null;
		}
		let candidate = null;
		contentState.getBlockMap().forEach((block, blockKey) => {
			if (candidate || ignoredBlocks.has(blockKey)) {
				return;
			}
			visitMediaEntities(contentState, block, (entityKey, data) => {
				if (!candidate && !previousEntities.has(entityKey)) {
					candidate = {
						blockKey,
						entityKey,
						dataSignature: getMediaDataSignature(data)
					};
				}
			});
		});
		return candidate;
	}

	async function waitForStableMediaUpload(draftNode, previousEntities, ignoredBlocks, timeoutMs) {
		const startedAt = Date.now();
		let identity = "";
		let dataSignature = "";
		let stableSince = 0;
		while (Date.now() - startedAt < timeoutMs) {
			const latestNode = findDraftStateNode() || draftNode;
			const candidate = findNewMediaUpload(latestNode, previousEntities, ignoredBlocks);
			if (!candidate) {
				identity = "";
				dataSignature = "";
				stableSince = 0;
			} else {
				const nextIdentity = `${candidate.entityKey}:${candidate.blockKey}`;
				if (nextIdentity !== identity || candidate.dataSignature !== dataSignature) {
					identity = nextIdentity;
					dataSignature = candidate.dataSignature;
					stableSince = Date.now();
				} else if (Date.now() - stableSince >= 700) {
					return candidate;
				}
			}
			await delay(300);
		}
		return null;
	}

	function getMediaDataSignature(data) {
		const seen = new WeakSet();
		try {
			return JSON.stringify(data, (_key, value) => {
				if (typeof value === "function") {
					return `[function:${value.name || "anonymous"}]`;
				}
				if (typeof value === "string" && value.length > 180) {
					return `${value.slice(0, 180)}...`;
				}
				if (value && typeof value === "object") {
					if (seen.has(value)) {
						return "[circular]";
					}
					seen.add(value);
				}
				return value;
			}).slice(0, 1400);
		} catch (_error) {
			return "";
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
