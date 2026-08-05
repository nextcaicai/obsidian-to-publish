(function () {
	const REQUEST_SOURCE = "OTP_COMPANION_CSDN_UPLOAD_REQUEST_V1";
	const RESPONSE_SOURCE = "OTP_COMPANION_CSDN_UPLOAD_RESPONSE_V1";
	const SDK_WAIT_TIMEOUT_MS = 12000;

	function base64ToFile(asset) {
		const binary = atob(asset.base64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return new File([bytes], asset.name || "image.png", {
			type: asset.type || "image/png"
		});
	}

	async function uploadAssets(assets, options = {}) {
		const uploadImg = await waitForUploadSdk();
		return mapWithConcurrency(assets, normalizePositiveInteger(options.concurrency, 2), async (asset) => {
			try {
				const file = base64ToFile(asset);
				const result = await retry(() => uploadImg({
					file,
					appName: options.appName || "blog",
					imageTemplate: options.imageTemplate || "direct",
					env: options.env || "prod",
					currentLine: options.currentLine || "external"
				}), normalizePositiveInteger(options.retries, 2));
				const url = extractImageUrl(result);
				if (!url) {
					throw new Error("CSDN image upload completed without a resolvable image URL.");
				}
				return {
					url,
					width: result?.width || result?.ImageWidth || 0,
					height: result?.height || result?.ImageHeight || 0
				};
			} catch (error) {
				return {
					url: "",
					error: error?.message || "CSDN image upload failed."
				};
			}
		});
	}

	function waitForUploadSdk(timeoutMs = SDK_WAIT_TIMEOUT_MS) {
		const startedAt = Date.now();
		return new Promise((resolve, reject) => {
			const tick = () => {
				const uploadImg = window.csdn?.upload?.uploadImg;
				if (typeof uploadImg === "function") {
					resolve(uploadImg);
					return;
				}
				if (Date.now() - startedAt >= timeoutMs) {
					reject(new Error("CSDN upload SDK is not available on this page."));
					return;
				}
				window.setTimeout(tick, 300);
			};
			tick();
		});
	}

	function extractImageUrl(value, visited = new Set()) {
		if (!value) {
			return "";
		}

		if (typeof value === "string") {
			return extractImageUrlFromString(value);
		}

		if (typeof FormData !== "undefined" && value instanceof FormData) {
			return extractImageUrlFromFormData(value);
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				const url = extractImageUrl(item, visited);
				if (url) {
					return url;
				}
			}
			return "";
		}

		if (typeof value !== "object" || visited.has(value)) {
			return "";
		}
		visited.add(value);

		for (const key of ["url", "imageUrl", "imgUrl", "src", "location", "Location", "fileUrl", "filePath"]) {
			const url = extractImageUrl(value[key], visited);
			if (url) {
				return url;
			}
		}

		for (const key of Object.keys(value)) {
			const url = extractImageUrl(value[key], visited);
			if (url) {
				return url;
			}
		}

		return "";
	}

	function extractImageUrlFromString(value) {
		const decoded = decodeHtmlEntities(value);
		const directMatch = decoded.match(/https?:\/\/[^\s"'<>]+(?:csdnimg\.cn|csdn\.net)[^\s"'<>]*\.(?:png|jpe?g|gif|webp)(?:\?[^\s"'<>]*)?/i);
		if (directMatch) {
			return directMatch[0];
		}
		const xmlLocationMatch = decoded.match(/<Location>([^<]+)<\/Location>/i);
		if (xmlLocationMatch) {
			return extractImageUrlFromString(xmlLocationMatch[1]);
		}
		const jsonUrlMatch = decoded.match(/"(?:url|imageUrl|imgUrl|src|location|Location)"\s*:\s*"([^"]+)"/i);
		if (jsonUrlMatch) {
			return extractImageUrlFromString(jsonUrlMatch[1]);
		}
		const directPathMatch = decoded.match(/(?:^|["'\s])((?:direct|images)\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|gif|webp))(?:["'\s]|$)/i);
		if (directPathMatch) {
			return `https://i-blog.csdnimg.cn/${directPathMatch[1]}`;
		}
		return "";
	}

	function extractImageUrlFromFormData(data) {
		if (typeof data.entries !== "function") {
			return "";
		}
		for (const [, value] of data.entries()) {
			const url = extractImageUrl(value);
			if (url) {
				return url;
			}
		}
		return "";
	}

	function decodeHtmlEntities(value) {
		return String(value || "")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, "\"");
	}

	async function mapWithConcurrency(items, concurrency, mapper) {
		const results = new Array(items.length);
		let cursor = 0;
		const workers = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
			while (cursor < items.length) {
				const index = cursor;
				cursor += 1;
				results[index] = await mapper(items[index], index);
			}
		});
		await Promise.all(workers);
		return results;
	}

	async function retry(task, retries) {
		let lastError = null;
		for (let attempt = 0; attempt <= retries; attempt += 1) {
			try {
				return await task();
			} catch (error) {
				lastError = error;
				if (attempt < retries) {
					await delay(1000 * (attempt + 1));
				}
			}
		}
		throw lastError || new Error("CSDN image upload failed.");
	}

	function normalizePositiveInteger(value, fallback) {
		const number = Number(value);
		return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
	}

	function delay(ms) {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	window.addEventListener("message", async (event) => {
		if (event.source !== window || event.data?.source !== REQUEST_SOURCE) {
			return;
		}

		const requestId = event.data.requestId;
		try {
			const uploads = await uploadAssets(event.data.assets || [], event.data.options || {});
			window.postMessage({
				source: RESPONSE_SOURCE,
				requestId,
				ok: true,
				uploads
			}, window.location.origin);
		} catch (error) {
			window.postMessage({
				source: RESPONSE_SOURCE,
				requestId,
				ok: false,
				error: error?.stack || error?.message || "CSDN image upload failed."
			}, window.location.origin);
		}
	});
})();
