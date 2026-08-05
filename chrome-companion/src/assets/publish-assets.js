(function () {
	const MARKDOWN_ASSET_IMAGE_PATTERN = /!\[([^\]]*)]\(asset:\/\/([a-zA-Z0-9_-]+)\)/g;
	const DEFAULT_CONCURRENCY = 2;
	const DEFAULT_RETRIES = 2;
	const DEFAULT_RETRY_DELAY_MS = 800;

	function createAssetStore(assets = []) {
		const byId = new Map();
		const byFingerprint = new Map();
		for (const asset of Array.isArray(assets) ? assets : []) {
			if (!asset || asset.kind !== "image" || !asset.id) {
				continue;
			}
			const normalized = normalizeAsset(asset);
			byId.set(normalized.id, normalized);
			const fingerprint = getAssetFingerprint(normalized);
			if (!byFingerprint.has(fingerprint)) {
				byFingerprint.set(fingerprint, normalized.id);
			}
		}

		return {
			getById: (assetId) => byId.get(assetId) || null,
			getCanonicalId: (assetId) => {
				const asset = byId.get(assetId);
				if (!asset) {
					return assetId;
				}
				return byFingerprint.get(getAssetFingerprint(asset)) || assetId;
			},
			getFingerprint: (assetId) => {
				const asset = byId.get(assetId);
				return asset ? getAssetFingerprint(asset) : "";
			},
			values: () => Array.from(byId.values())
		};
	}

	function normalizeAsset(asset) {
		return {
			id: String(asset.id || ""),
			kind: "image",
			originalSrc: String(asset.originalSrc || ""),
			fileName: String(asset.fileName || asset.filename || `${asset.id || "image"}.png`),
			mime: String(asset.mime || asset.mimeType || "image/png"),
			bytes: Number(asset.bytes || asset.size || 0),
			base64: String(asset.base64 || ""),
			sha256: String(asset.sha256 || "")
		};
	}

	function getAssetFingerprint(asset) {
		if (asset.sha256) {
			return `${asset.mime}:${asset.bytes}:sha256:${asset.sha256}`;
		}
		if (asset.base64) {
			return `${asset.mime}:${asset.bytes}:base64:${hashStringFNV1a(asset.base64)}`;
		}
		return `${asset.mime}:${asset.bytes}:${asset.fileName}`;
	}

	function collectMarkdownAssetImages(markdown, assetStore) {
		const images = [];
		const source = String(markdown || "");
		let match;
		MARKDOWN_ASSET_IMAGE_PATTERN.lastIndex = 0;
		while ((match = MARKDOWN_ASSET_IMAGE_PATTERN.exec(source)) !== null) {
			const assetId = match[2];
			const asset = assetStore.getById(assetId);
			if (!asset) {
				continue;
			}
			images.push({
				raw: match[0],
				alt: sanitizeImageAlt(match[1] || asset.fileName),
				assetId,
				canonicalAssetId: assetStore.getCanonicalId(assetId),
				asset
			});
		}
		return images;
	}

	async function uploadMarkdownAssets({ markdown, assets, uploadAsset, cache, concurrency, retries, retryDelayMs, logger = console }) {
		const assetStore = createAssetStore(assets);
		const images = collectMarkdownAssetImages(markdown, assetStore);
		const uniqueImages = [];
		const seen = new Set();
		for (const image of images) {
			if (seen.has(image.canonicalAssetId)) {
				continue;
			}
			seen.add(image.canonicalAssetId);
			uniqueImages.push(image);
		}

		const uploadedByCanonicalId = new Map();
		await pMap(uniqueImages, async (image) => {
			const cacheKey = assetStore.getFingerprint(image.canonicalAssetId) || image.canonicalAssetId;
			const cached = cache?.get?.(cacheKey);
			if (cached?.url) {
				uploadedByCanonicalId.set(image.canonicalAssetId, {
					assetId: image.canonicalAssetId,
					url: cached.url,
					fromCache: true
				});
				return;
			}

			try {
				const uploaded = await retry(() => uploadAsset(image.asset), {
					retries: retries ?? DEFAULT_RETRIES,
					delayMs: retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
				});
				const url = String(uploaded?.url || "");
				if (!url) {
					throw new Error("Image upload returned an empty URL.");
				}
				const result = {
					assetId: image.canonicalAssetId,
					url,
					width: uploaded?.width || 0,
					height: uploaded?.height || 0
				};
				uploadedByCanonicalId.set(image.canonicalAssetId, result);
				cache?.set?.(cacheKey, result);
			} catch (error) {
				const message = error?.message || String(error || "Image upload failed.");
				logger.warn?.("Image asset upload failed.", {
					assetId: image.assetId,
					fileName: image.asset.fileName,
					message
				});
				uploadedByCanonicalId.set(image.canonicalAssetId, {
					assetId: image.canonicalAssetId,
					url: "",
					error: message
				});
			}
		}, concurrency ?? DEFAULT_CONCURRENCY);

		const urlByAssetId = new Map();
		for (const image of images) {
			const uploaded = uploadedByCanonicalId.get(image.canonicalAssetId);
			if (uploaded?.url) {
				urlByAssetId.set(image.assetId, uploaded.url);
			}
		}

		return {
			images,
			urlByAssetId,
			uploads: Array.from(uploadedByCanonicalId.values()),
			markdown: rewriteMarkdownAssetImages(markdown, urlByAssetId)
		};
	}

	function rewriteMarkdownAssetImages(markdown, urlByAssetId) {
		return String(markdown || "").replace(MARKDOWN_ASSET_IMAGE_PATTERN, (match, alt, assetId) => {
			const url = urlByAssetId.get(assetId);
			if (!url) {
				return `[[OTP_IMAGE_${assetId}_UPLOAD_FAILED]]`;
			}
			return `![${sanitizeImageAlt(alt)}](${url})`;
		});
	}

	async function pMap(items, mapper, concurrency = DEFAULT_CONCURRENCY) {
		const normalizedConcurrency = Math.max(1, Math.floor(Number(concurrency) || DEFAULT_CONCURRENCY));
		const results = new Array(items.length);
		let cursor = 0;
		const workers = new Array(Math.min(normalizedConcurrency, items.length)).fill(null).map(async () => {
			while (cursor < items.length) {
				const index = cursor;
				cursor += 1;
				results[index] = await mapper(items[index], index);
			}
		});
		await Promise.all(workers);
		return results;
	}

	async function retry(task, options = {}) {
		const retries = Math.max(0, Math.floor(Number(options.retries) || 0));
		const delayMs = Math.max(0, Math.floor(Number(options.delayMs) || 0));
		let lastError = null;
		for (let attempt = 0; attempt <= retries; attempt += 1) {
			try {
				return await task();
			} catch (error) {
				lastError = error;
				if (attempt < retries && delayMs > 0) {
					await delay(delayMs * (attempt + 1));
				}
			}
		}
		throw lastError || new Error("Operation failed.");
	}

	function assetToFile(asset) {
		if (!asset?.base64 || typeof File !== "function") {
			return null;
		}
		try {
			const binary = atob(asset.base64);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) {
				bytes[index] = binary.charCodeAt(index);
			}
			return new File([bytes], asset.fileName || `${asset.id}.png`, {
				type: asset.mime || "image/png"
			});
		} catch (error) {
			console.warn("Unable to decode publish asset.", error);
			return null;
		}
	}

	function sanitizeImageAlt(value) {
		return String(value || "image").replace(/[\]\n\r]/g, " ").trim() || "image";
	}

	function hashStringFNV1a(value) {
		let hash = 0x811c9dc5;
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 0x01000193);
		}
		return (hash >>> 0).toString(16).padStart(8, "0");
	}

	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	const api = {
		assetToFile,
		collectMarkdownAssetImages,
		createAssetStore,
		pMap,
		rewriteMarkdownAssetImages,
		uploadMarkdownAssets
	};

	globalThis.OTPCompanionAssets = api;
	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
})();
