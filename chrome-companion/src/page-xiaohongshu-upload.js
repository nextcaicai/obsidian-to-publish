(function () {
	const REQUEST_SOURCE = "OTP_COMPANION_XIAOHONGSHU_UPLOAD_REQUEST_V2";
	const RESPONSE_SOURCE = "OTP_COMPANION_XIAOHONGSHU_UPLOAD_RESPONSE_V2";

	window.addEventListener("message", (event) => {
		if (event.source !== window || event.data?.source !== REQUEST_SOURCE) {
			return;
		}
		void handleUploadRequest(event.data);
	});

	async function handleUploadRequest(message) {
		const core = globalThis.OTPProseMirrorCore;
		const assets = Array.isArray(message.assets) ? message.assets : [];
		const options = message.options || {};
		const editorContext = await core?.waitForValue(
			() => {
				const root = core.findEditorRoot();
				const view = root ? core.findEditorView(root) : null;
				return root && view ? { root, view } : null;
			},
			options.editorWaitMs || 10000,
			150
		);
		if (!core || !editorContext) {
			postResponse(message.requestId, false, [], false, "Xiaohongshu editor state was not reachable.");
			return;
		}
		const markers = assets.map((asset) => String(asset?.marker || "")).filter(Boolean);
		const markersReady = await core.waitForCondition(
			() => {
				const view = core.findEditorView(editorContext.root) || editorContext.view;
				return markers.every((marker) => core.findMarker(view.state.doc, marker));
			},
			options.markerWaitMs || 10000,
			150
		);
		if (!markersReady) {
			postResponse(message.requestId, false, [], false, "Xiaohongshu image markers were not ready.");
			return;
		}

		const uploads = [];
		for (const asset of assets) {
			const view = core.findEditorView(editorContext.root) || editorContext.view;
			uploads.push(await uploadAssetAtMarker(core, view, editorContext.root, asset, options));
		}
		postResponse(message.requestId, true, uploads, true);
	}

	async function uploadAssetAtMarker(core, view, root, asset, options) {
		const marker = String(asset?.marker || "");
		if (!marker || !core.placeSelectionAtMarker(view, marker)) {
			return { ok: false, placed: false, error: "Xiaohongshu image marker was not found." };
		}
		let file;
		try {
			file = core.base64ToFile(
				String(asset.base64 || ""),
				String(asset.name || asset.fileName || "image.png"),
				String(asset.type || asset.mime || "image/png")
			);
		} catch (error) {
			return { ok: false, placed: false, error: error?.message || "Image data was invalid." };
		}

		const beforeCounts = core.captureImageFingerprintCounts(view.state.doc);
		await core.delay(60);
		if (!core.dispatchFilePaste(root, file)) {
			return { ok: false, placed: false, error: "Xiaohongshu rejected the image paste event." };
		}
		const uploadedState = await waitForStableNewImages(
			core,
			root,
			view,
			beforeCounts,
			options.imageUploadWaitMs || 60000,
			options.imageSettleMs || 1400
		);
		if (!uploadedState) {
			return { ok: false, placed: false, error: "Xiaohongshu image upload timed out.", marker };
		}

		const latestView = core.findEditorView(root) || uploadedState.view;
		const deduplication = core.deduplicateNewImageBlocksAtMarker(
			latestView,
			marker,
			beforeCounts
		);
		if (!deduplication.ok) {
			return {
				ok: false,
				placed: false,
				error: "Xiaohongshu uploaded the image, but its duplicate blocks could not be resolved.",
				marker
			};
		}
		const cleanedView = core.findEditorView(root) || latestView;
		if (!core.hasImageImmediatelyBeforeMarker(cleanedView.state.doc, marker)) {
			return {
				ok: false,
				placed: false,
				error: "Xiaohongshu uploaded the image away from its marker; the marker was preserved.",
				marker
			};
		}
		const markerCleaned = core.removeMarker(cleanedView, marker);
		return markerCleaned
			? {
				ok: true,
				placed: true,
				markerCleaned: true,
				duplicatesRemoved: deduplication.removed,
				marker
			}
			: { ok: false, placed: false, markerCleaned: false, error: "Xiaohongshu marker cleanup failed.", marker };
	}

	async function waitForStableNewImages(core, root, fallbackView, beforeCounts, timeoutMs, settleMs) {
		const startedAt = Date.now();
		let signature = "";
		let stableSince = 0;
		let latestState = null;
		while (Date.now() - startedAt < timeoutMs) {
			const view = core.findEditorView(root) || fallbackView;
			const imageBlocks = core.findNewImageBlocks(view.state.doc, beforeCounts);
			if (imageBlocks.length === 0) {
				signature = "";
				stableSince = 0;
				latestState = null;
			} else {
				const nextSignature = imageBlocks
					.map((entry) => `${entry.fingerprint}:${entry.occurrence}:${entry.pos}`)
					.join("|");
				latestState = { view, imageBlocks };
				if (nextSignature !== signature) {
					signature = nextSignature;
					stableSince = Date.now();
				} else if (Date.now() - stableSince >= settleMs) {
					return latestState;
				}
			}
			await core.delay(250);
		}
		return null;
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
})();
