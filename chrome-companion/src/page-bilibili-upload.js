(function () {
	const REQUEST_SOURCE = "OTP_COMPANION_BILIBILI_UPLOAD_REQUEST_V1";
	const RESPONSE_SOURCE = "OTP_COMPANION_BILIBILI_UPLOAD_RESPONSE_V1";

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
			postResponse(message.requestId, false, [], false, "Bilibili editor state was not reachable.");
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
			postResponse(message.requestId, false, [], false, "Bilibili image markers were not ready.");
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
			return { ok: false, placed: false, error: "Bilibili image marker was not found." };
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
			return { ok: false, placed: false, error: "Bilibili rejected the image paste event." };
		}
		const uploadedImage = await core.waitForValue(
			() => {
				const latestView = core.findEditorView(root) || view;
				const imageBlock = core.findNewImageBlock(latestView.state.doc, beforeCounts);
				return imageBlock ? { view: latestView, imageBlock } : null;
			},
			options.imageUploadWaitMs || 60000,
			300
		);
		if (!uploadedImage) {
			return { ok: false, placed: false, error: "Bilibili image upload timed out.", marker };
		}

		await core.delay(150);
		const latestView = core.findEditorView(root) || uploadedImage.view;
		const settledImageBlock = core.findNewImageBlock(latestView.state.doc, beforeCounts)
			|| uploadedImage.imageBlock;
		const placed = core.relocateImageBlockToMarker(
			latestView,
			marker,
			settledImageBlock
		);
		return placed
			? { ok: true, placed: true, markerCleaned: true, marker }
			: {
				ok: false,
				placed: false,
				markerCleaned: false,
				error: "Bilibili uploaded the image, but its block could not be moved to the marker.",
				marker
			};
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
